const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json'); // Path to your Firebase service account JSON
const express = require('express');
const app = express();

const token = process.env.TELEGRAM_BOT_TOKEN; // Use environment variable for bot token
const adminChatIds = [process.env.ADMIN_CHAT_ID_1, process.env.ADMIN_CHAT_ID_2]; // Use environment variables for admin chat IDs

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://user-storage-74dd4-default-rtdb.firebaseio.com/' // Your database URL
});

const db = admin.database();
const bot = new TelegramBot(token, { polling: true });

const bannedUsers = {}; // To store banned users
const lastReplyTimes = {}; // To store the last reply times
const activeChats = {}; // To store active chat sessions
const awaitingName = {}; // To track users awaiting a name input

// Function to determine the time of day in Bangladesh
const getBangladeshGreeting = () => {
  const bdTime = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  const hour = new Date(bdTime).getHours();

  if (hour >= 5 && hour < 12) {
    return "Good Morning";
  } else if (hour >= 12 && hour < 17) {
    return "Good Afternoon";
  } else if (hour >= 17 && hour < 21) {
    return "Good Evening";
  } else {
    return "Good Night";
  }
};

// Save user to Firebase
const saveUser = (chatId, userFullName) => {
  db.ref(`users/${chatId}`).set({
    name: userFullName
  }, (error) => {
    if (error) {
      console.error('Error saving user to Firebase:', error);
    }
  });
};

// Handle start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

  // Check if the user is banned
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, '*You are banned from using this bot.*', { parse_mode: 'Markdown' });
    return;
  }

  saveUser(chatId, userFullName);

  const greeting = getBangladeshGreeting();
  const welcomeMessage = `${greeting} ${userFullName}!\n\nPlease select your preferred language:\n\n${greeting}, ${userFullName}!\n\nঅনুগ্রহ করে আপনার পছন্দের ভাষা নির্বাচন করুন:`;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'বাংলা', callback_data: 'language_bn' }],
        [{ text: 'English', callback_data: 'language_en' }]
      ]
    }
  };

  bot.sendMessage(chatId, welcomeMessage, options);
});

// Handle language selection callback queries
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  // Check if the user is banned
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, '*You are banned from using this bot.*', { parse_mode: 'Markdown' });
    return;
  }

  let responseMessage = '';
  if (callbackQuery.data === 'language_bn') {
    // Set the language to Bangla
    db.ref(`users/${chatId}`).update({ language: 'bn' });
    responseMessage = '*আপনি বাংলা ভাষা নির্বাচন করেছেন।*\n\nঅনুগ্রহ করে আপনার পছন্দের অপশন নির্বাচন করুন:';
  } else if (callbackQuery.data === 'language_en') {
    // Set the language to English
    db.ref(`users/${chatId}`).update({ language: 'en' });
    responseMessage = '*You have selected English.*\n\nPlease select your preferred option:';
  }

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: callbackQuery.data === 'language_bn' ? 'আমাদের চ্যানেল জয়েন করুন' : 'Join Our Channel', url: 'https://t.me/your_channel' }],
        [{ text: callbackQuery.data === 'language_bn' ? 'কাস্টমার সার্ভিস' : 'Customer Service', callback_data: 'customer_service' }]
      ]
    }
  };

  bot.sendMessage(chatId, responseMessage, options);
});

// Handle customer service request
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  if (callbackQuery.data === 'customer_service') {
    // Ask the user for their name
    bot.sendMessage(chatId, '*Please enter your name so that we can better assist you.*', { parse_mode: 'Markdown' });

    // Mark this user as awaiting name input
    awaitingName[chatId] = true;
  }
});

// Handle incoming messages (e.g., user's name)
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;

  // Check if the user is currently being asked for their name
  if (awaitingName[chatId]) {
    // Save the user's name to Firebase
    db.ref(`users/${chatId}`).update({ providedName: userMessage });

    // Remove the user from the awaitingName object
    delete awaitingName[chatId];

    // Retrieve user information from Firebase
    db.ref(`users/${chatId}`).once('value', (snapshot) => {
      const userInfo = snapshot.val();
      const userFullName = userInfo.name;
      const providedName = userMessage; // The name provided by the user
      const language = userInfo.language;

      // Notify admins about the live chat request
      adminChatIds.forEach((adminChatId) => {
        const options = {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Deny', callback_data: `deny_${chatId}` }],
              [{ text: 'Start Conversation', callback_data: `start_chat_${chatId}` }]
            ]
          }
        };

        bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*User:* ${userFullName}\n*Provided Name:* ${providedName}\n*ID:* ${chatId}\n*Language:* ${language}`, options);
      });

      // Notify the user that their request has been sent
      bot.sendMessage(chatId, '*Your request has been sent to customer service. Please wait for a response.*', { parse_mode: 'Markdown' });
    });
  } else if (activeChats[chatId]) {
    // Forward messages between user and admin during an active chat session
    const recipientChatId = activeChats[chatId];

    // Stop conversation if the admin sends the "Stop Conversation" message
    if (userMessage.toLowerCase() === 'stop conversation') {
      delete activeChats[chatId];
      delete activeChats[recipientChatId];

      bot.sendMessage(chatId, '*Conversation has been stopped.*', { parse_mode: 'Markdown' });
      bot.sendMessage(recipientChatId, '*The conversation has been stopped by customer service.*', { parse_mode: 'Markdown' });

      return;
    }

    // Forward messages between user and admin
    bot.sendMessage(recipientChatId, userMessage);
  } else {
    // Handle regular message processing or other commands
    if (adminChatIds.includes(chatId.toString())) {
      return; // Admins should not be able to use this section of the bot
    }

    if (bannedUsers[chatId]) {
      bot.sendMessage(chatId, '*You are banned from using this bot.*', { parse_mode: 'Markdown' });
      return;
    }

    if (userMessage && !userMessage.startsWith('/')) {
      const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

      // Forward the user message to admin chat IDs and store metadata
      adminChatIds.forEach(adminChatId => {
        bot.forwardMessage(adminChatId, chatId, msg.message_id).then((forwardedMsg) => {
          // Store metadata in Firebase
          db.ref(`messages/${forwardedMsg.message_id}`).set({
            originalChatId: chatId,
            originalMessageId: msg.message_id,
            userFullName: userFullName,
            text: userMessage,
            timestamp: Date.now()
          });
        });
      });

      // Check if the last reply was sent more than 15 minutes ago and send an automatic reply
      if (!lastReplyTimes[chatId] || Date.now() - lastReplyTimes[chatId] > 15 * 60 * 1000) {
        lastReplyTimes[chatId] = Date.now();
        bot.sendMessage(chatId, 'Thank you for your message! Our support team will get back to you shortly. Meanwhile, you can also join our support group at: https://t.me/your_support.');
      }
    }
  }
});

// Handle admin responses to live chat requests
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const adminChatId = message.chat.id;
  const actionData = callbackQuery.data.split('_');
  const action = actionData[0];
  const chatId = actionData[1];

  if (action === 'deny') {
    bot.sendMessage(chatId, '*Your live chat request has been denied.*', { parse_mode: 'Markdown' });
  } else if (action === 'start') {
    activeChats[chatId] = adminChatId;
    activeChats[adminChatId] = chatId;

    bot.sendMessage(chatId, '*You are now connected to customer service. Feel free to ask your questions.*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*You are now connected to the user. Please assist them.*', { parse_mode: 'Markdown' });
  }
});

// Ban command to block users from using the bot
bot.onText(/\/ban (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userIdOrUsername = match[1].trim();

  if (adminChatIds.includes(chatId.toString())) {
    if (!userIdOrUsername) {
      bot.sendMessage(chatId, 'Please provide a user ID or username to ban.');
      return;
    }

    if (/^\d+$/.test(userIdOrUsername)) {
      // It's a user ID
      bannedUsers[userIdOrUsername] = true;
      bot.sendMessage(chatId, `User with ID ${userIdOrUsername} has been banned.`);
    } else {
      // It's a username
      bot.getChat(userIdOrUsername).then(userChat => {
        const userChatId = userChat.id;
        bannedUsers[userChatId] = true;
        bot.sendMessage(chatId, `User with username ${userIdOrUsername} has been banned.`);
      }).catch(error => {
        bot.sendMessage(chatId, `Could not find user with username ${userIdOrUsername}.`);
      });
    }
  }
});

// Unban command to allow users to use the bot again
bot.onText(/\/unban (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userIdOrUsername = match[1].trim();

  if (adminChatIds.includes(chatId.toString())) {
    if (!userIdOrUsername) {
      bot.sendMessage(chatId, 'Please provide a user ID or username to unban.');
      return;
    }

    if (/^\d+$/.test(userIdOrUsername)) {
      // It's a user ID
      delete bannedUsers[userIdOrUsername];
      bot.sendMessage(chatId, `User with ID ${userIdOrUsername} has been unbanned.`);
    } else {
      // It's a username
      bot.getChat(userIdOrUsername).then(userChat => {
        const userChatId = userChat.id;
        delete bannedUsers[userChatId];
        bot.sendMessage(chatId, `User with username ${userIdOrUsername} has been unbanned.`);
      }).catch(error => {
        bot.sendMessage(chatId, `Could not find user with username ${userIdOrUsername}.`);
      });
    }
  }
});

// View banned users command
bot.onText(/\/banned/, (msg) => {
  const chatId = msg.chat.id;

  if (adminChatIds.includes(chatId.toString())) {
    const bannedUserList = Object.keys(bannedUsers).map(userId => `ID: ${userId}`).join('\n');
    bot.sendMessage(chatId, `Banned users:\n\n${bannedUserList}`);
  }
});

// Express server to keep the bot alive (for environments like Heroku)
app.get('/', (req, res) => {
  res.send('Telegram bot is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

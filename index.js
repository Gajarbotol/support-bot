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
const awaitingName = {}; // To track users awaiting name input

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
  const greetingMessage = `${greeting}, ${userFullName}!`;

  // Send the greeting message
  bot.sendMessage(chatId, greetingMessage);

  // Separate message for language selection
  const languageMessage = `Please select your preferred language:\n\nঅনুগ্রহ করে আপনার পছন্দের ভাষা নির্বাচন করুন:`;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'বাংলা', callback_data: 'language_bn' }],
        [{ text: 'English', callback_data: 'language_en' }]
      ]
    }
  };

  // Send the language selection message
  bot.sendMessage(chatId, languageMessage, options);
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
    // Ask for the user's name before proceeding
    awaitingName[chatId] = true;
    bot.sendMessage(chatId, '*Please enter your name to proceed with the live chat request.*', { parse_mode: 'Markdown' });
  }
});

// Handle name input and forward to admin
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (awaitingName[chatId]) {
    const userProvidedName = text.trim();

    // Save the name to Firebase and update the user info
    db.ref(`users/${chatId}`).update({ providedName: userProvidedName });

    // Notify the admins with all the details
    db.ref(`users/${chatId}`).once('value', (snapshot) => {
      const userInfo = snapshot.val();
      const userFullName = userInfo.name;
      const language = userInfo.language || 'Not set';

      adminChatIds.forEach((adminChatId) => {
        const options = {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Deny', callback_data: `deny_${chatId}` }],
              [{ text: 'Start Conversation', callback_data: `start_${chatId}` }]
            ]
          }
        };

        bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*User's Full Name:* ${userFullName}\n*Provided Name:* ${userProvidedName}\n*ID:* ${chatId}\n*Language:* ${language}`, options);
      });
    });

    // Confirm to the user
    bot.sendMessage(chatId, '*Your request has been sent to customer service. Please wait for a response.*', { parse_mode: 'Markdown' });

    // Stop waiting for the name
    delete awaitingName[chatId];
  } else if (activeChats[chatId]) {
    // Handle active chat sessions
    const recipientChatId = activeChats[chatId];

    // Stop conversation if the admin sends the "Stop Conversation" message
    if (msg.text.toLowerCase() === 'stop conversation') {
      delete activeChats[chatId];
      delete activeChats[recipientChatId];

      bot.sendMessage(chatId, '*Conversation has been stopped.*', { parse_mode: 'Markdown' });
      bot.sendMessage(recipientChatId, '*The conversation has been stopped by customer service.*', { parse_mode: 'Markdown' });

      return;
    }

    // Forward messages between user and admin
    bot.sendMessage(recipientChatId, msg.text);
  } else {
    // Regular message handling
    if (adminChatIds.includes(chatId.toString())) {
      return; // Admins should not be able to use this section of the bot
    }

    if (bannedUsers[chatId]) {
      bot.sendMessage(chatId, '*You are banned from using this bot.*', { parse_mode: 'Markdown' });
      return;
    }

    if (msg.text && !msg.text.startsWith('/')) {
      const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

      // Forward the user message to admin chat IDs and store metadata
      adminChatIds.forEach(adminChatId => {
        bot.forwardMessage(adminChatId, chatId, msg.message_id).then((forwardedMsg) => {
          // Store metadata in Firebase
          db.ref(`messages/${forwardedMsg.message_id}`).set({
            originalChatId: chatId,
            originalMessageId: msg.message_id,
            userFullName: userFullName,
            text: msg.text,
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
    // Start the live chat session
    activeChats[chatId] = adminChatId;
    activeChats[adminChatId] = chatId;

    bot.sendMessage(chatId, '*You are now connected to customer service. Feel free to ask your questions.*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*You are now connected with the user. You can start the conversation.*', { parse_mode: 'Markdown' });
  }
});

// Handle banning a user
bot.onText(/\/ban (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1].trim();

  if (!adminChatIds.includes(chatId.toString())) {
    bot.sendMessage(chatId, '*You are not authorized to use this command.*', { parse_mode: 'Markdown' });
    return;
  }

  let targetChatId;

  if (input.startsWith('@')) {
    // Ban by username
    const username = input.substring(1);
    db.ref('users').orderByChild('username').equalTo(username).once('value', snapshot => {
      if (snapshot.exists()) {
        snapshot.forEach(childSnapshot => {
          targetChatId = childSnapshot.key;
          bannedUsers[targetChatId] = true;
          db.ref(`banned/${targetChatId}`).set(true);
          bot.sendMessage(chatId, `*User ${username} has been banned.*`, { parse_mode: 'Markdown' });
        });
      } else {
        bot.sendMessage(chatId, `*No user found with username @${username}.*`, { parse_mode: 'Markdown' });
      }
    });
  } else {
    // Ban by chat ID
    targetChatId = input;
    bannedUsers[targetChatId] = true;
    db.ref(`banned/${targetChatId}`).set(true);
    bot.sendMessage(chatId, `*User with ID ${targetChatId} has been banned.*`, { parse_mode: 'Markdown' });
  }
});

// Handle unbanning a user
bot.onText(/\/unban (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1].trim();

  if (!adminChatIds.includes(chatId.toString())) {
    bot.sendMessage(chatId, '*You are not authorized to use this command.*', { parse_mode: 'Markdown' });
    return;
  }

  let targetChatId;

  if (input.startsWith('@')) {
    // Unban by username
    const username = input.substring(1);
    db.ref('users').orderByChild('username').equalTo(username).once('value', snapshot => {
      if (snapshot.exists()) {
        snapshot.forEach(childSnapshot => {
          targetChatId = childSnapshot.key;
          delete bannedUsers[targetChatId];
          db.ref(`banned/${targetChatId}`).remove();
          bot.sendMessage(chatId, `*User ${username} has been unbanned.*`, { parse_mode: 'Markdown' });
        });
      } else {
        bot.sendMessage(chatId, `*No user found with username @${username}.*`, { parse_mode: 'Markdown' });
      }
    });
  } else {
    // Unban by chat ID
    targetChatId = input;
    delete bannedUsers[targetChatId];
    db.ref(`banned/${targetChatId}`).remove();
    bot.sendMessage(chatId, `*User with ID ${targetChatId} has been unbanned.*`, { parse_mode: 'Markdown' });
  }
});

// Handle fetching the list of banned users
bot.onText(/\/banned/, (msg) => {
  const chatId = msg.chat.id;

  if (!adminChatIds.includes(chatId.toString())) {
    bot.sendMessage(chatId, '*You are not authorized to use this command.*', { parse_mode: 'Markdown' });
    return;
  }

  db.ref('banned').once('value', (snapshot) => {
    if (snapshot.exists()) {
      let bannedList = '*Banned Users:*\n';
      snapshot.forEach((childSnapshot) => {
        bannedList += `\n- ${childSnapshot.key}`;
      });
      bot.sendMessage(chatId, bannedList, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '*No banned users found.*', { parse_mode: 'Markdown' });
    }
  });
});

// Start Express server (optional, if you want to serve webhooks or health checks)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

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

  // Delete the original message
  bot.deleteMessage(chatId, message.message_id);

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

  // Delete the original message
  bot.deleteMessage(chatId, message.message_id);

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
    const recipientChatId = activeChats[chatId];

    // Forward the user's message to the admin
    bot.sendMessage(recipientChatId, text);

  } else if (adminChatIds.includes(chatId.toString()) && activeChats[chatId]) {
    const recipientChatId = activeChats[chatId];

    // Forward the admin's message to the user
    bot.sendMessage(recipientChatId, text);
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

  // Delete the original message
  bot.deleteMessage(adminChatId, message.message_id);

  if (action === 'deny') {
    bot.sendMessage(chatId, '*Your live chat request has been denied.*', { parse_mode: 'Markdown' });
  } else if (action === 'start') {
    // Start the live chat session
    activeChats[chatId] = adminChatId;
    activeChats[adminChatId] = chatId;

    bot.sendMessage(chatId, '*You are now connected to customer service. Feel free to ask your questions.*\n*Note: Only the admin can stop the conversation.*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*You are now connected with the user. You can start the conversation.*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Stop Conversation', callback_data: `stop_${chatId}` }]
        ]
      }
    });
  } else if (action === 'stop') {
    // Stop the live chat session
    delete activeChats[chatId];
    delete activeChats[adminChatId];

    bot.sendMessage(chatId, '*The conversation has been stopped by customer service.*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*Conversation has been stopped.*', { parse_mode: 'Markdown' });
  }
});

// Ban a user
bot.onText(/\/ban (\d+)/, (msg, match) => {
  const adminChatId = msg.chat.id;

  if (!adminChatIds.includes(adminChatId.toString())) {
    return; // Only allow admins to use the ban command
  }

  const chatIdToBan = match[1];
  bannedUsers[chatIdToBan] = true;

  bot.sendMessage(chatIdToBan, '*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
  bot.sendMessage(adminChatId, `*User with ID ${chatIdToBan} has been banned.*`, { parse_mode: 'Markdown' });
});

// Unban a user
bot.onText(/\/unban (\d+)/, (msg, match) => {
  const adminChatId = msg.chat.id;

  if (!adminChatIds.includes(adminChatId.toString())) {
    return; // Only allow admins to use the unban command
  }

  const chatIdToUnban = match[1];
  delete bannedUsers[chatIdToUnban];

  bot.sendMessage(chatIdToUnban, '*You have been unbanned. You can now use the bot again.*', { parse_mode: 'Markdown' });
  bot.sendMessage(adminChatId, `*User with ID ${chatIdToUnban} has been unbanned.*`, { parse_mode: 'Markdown' });
});

// List all banned users
bot.onText(/\/banned/, (msg) => {
  const adminChatId = msg.chat.id;

  if (!adminChatIds.includes(adminChatId.toString())) {
    return; // Only allow admins to use the banned command
  }

  const bannedList = Object.keys(bannedUsers);

  if (bannedList.length === 0) {
    bot.sendMessage(adminChatId, '*No users are currently banned.*', { parse_mode: 'Markdown' });
  } else {
    bot.sendMessage(adminChatId, `*Banned Users:*\n${bannedList.join('\n')}`, { parse_mode: 'Markdown' });
  }
});

// Express server for health check
app.get('/', (req, res) => {
  res.send('Bot is running');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

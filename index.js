const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
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
    bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*', { parse_mode: 'Markdown' });
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
    bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*', { parse_mode: 'Markdown' });
    return;
  }

  let responseMessage = '';
  let optionLabels = { channel: '', customerService: '' };
  if (callbackQuery.data === 'language_bn') {
    // Set the language to Bangla
    db.ref(`users/${chatId}`).update({ language: 'bn' });
    responseMessage = '*আপনি বাংলা ভাষা নির্বাচন করেছেন।*\n\nঅনুগ্রহ করে আপনার পছন্দের অপশন নির্বাচন করুন:';
    optionLabels.channel = 'আমাদের চ্যানেল জয়েন করুন';
    optionLabels.customerService = 'কাস্টমার সার্ভিস';
  } else if (callbackQuery.data === 'language_en') {
    // Set the language to English
    db.ref(`users/${chatId}`).update({ language: 'en' });
    responseMessage = '*You have selected English.*\n\nPlease select your preferred option:';
    optionLabels.channel = 'Join Our Channel';
    optionLabels.customerService = 'Customer Service';
  }

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: optionLabels.channel, url: 'https://t.me/your_channel' }],
        [{ text: optionLabels.customerService, callback_data: 'customer_service' }]
      ]
    }
  };

  // Send the options message
  bot.sendMessage(chatId, responseMessage, options);
});

// Handle customer service request
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  if (callbackQuery.data === 'customer_service') {
    awaitingName[chatId] = true;
    bot.sendMessage(chatId, '*অনুগ্রহ করে লাইভ চ্যাট চালিয়ে যাওয়ার জন্য আপনার নাম লিখুন।*', { parse_mode: 'Markdown' });
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

        bot.sendMessage(adminChatId, `*নতুন লাইভ চ্যাট অনুরোধ*\n\n*ব্যবহারকারীর পুরো নাম:* ${userFullName}\n*প্রদত্ত নাম:* ${userProvidedName}\n*ID:* ${chatId}\n*ভাষা:* ${language}`, options);
      });
    });

    bot.sendMessage(chatId, '*আপনার অনুরোধ গ্রাহক সেবায় পাঠানো হয়েছে। অনুগ্রহ করে একটি প্রতিক্রিয়া জন্য অপেক্ষা করুন।*', { parse_mode: 'Markdown' });
    delete awaitingName[chatId];
  } else if (activeChats[chatId]) {
    const recipientChatId = activeChats[chatId];
    bot.sendMessage(recipientChatId, msg.text);
  } else if (adminChatIds.includes(chatId.toString())) {
    return; // Admins should not be able to use this section of the bot
  } else if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*', { parse_mode: 'Markdown' });
  } else if (msg.text && !msg.text.startsWith('/')) {
    const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

    adminChatIds.forEach(adminChatId => {
      bot.forwardMessage(adminChatId, chatId, msg.message_id).then((forwardedMsg) => {
        db.ref(`messages/${forwardedMsg.message_id}`).set({
          originalChatId: chatId,
          originalMessageId: msg.message_id,
          userFullName: userFullName,
          text: msg.text,
          timestamp: Date.now()
        });
      });
    });

    if (!lastReplyTimes[chatId] || Date.now() - lastReplyTimes[chatId] > 15 * 60 * 1000) {
      lastReplyTimes[chatId] = Date.now();
      const language = db.ref(`users/${chatId}/language`).once('value').then((snapshot) => snapshot.val());
      const thankYouMessage = language === 'bn'
        ? 'আপনার বার্তার জন্য ধন্যবাদ! আমাদের সহায়তা দল শীঘ্রই আপনার সাথে যোগাযোগ করবে। ইতিমধ্যে, আপনি আমাদের সহায়তা গ্রুপে যোগ দিতে পারেন: https://t.me/your_support।'
        : 'Thank you for your message! Our support team will get back to you shortly. Meanwhile, you can also join our support group at: https://t.me/your_support.';
      bot.sendMessage(chatId, thankYouMessage);
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
    bot.sendMessage(chatId, '*আপনার লাইভ চ্যাট অনুরোধটি প্রশাসক দ্বারা প্রত্যাখ্যান করা হয়েছে।*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*আপনার অনুরোধ প্রত্যাখ্যান করা হয়েছে।*', { parse_mode: 'Markdown' });
  } else if (action === 'start') {
    activeChats[adminChatId] = chatId;
    activeChats[chatId] = adminChatId;
    bot.sendMessage(adminChatId, '*আপনি এখন ব্যবহারকারীর সাথে লাইভ চ্যাটে রয়েছেন।*', { parse_mode: 'Markdown' });
    bot.sendMessage(chatId, '*আপনি এখন প্রশাসকের সাথে লাইভ চ্যাটে রয়েছেন।*', { parse_mode: 'Markdown' });
  }
});

// Admin command to ban a user
bot.onText(/\/ban (.+)/, (msg, match) => {
  const adminChatId = msg.chat.id;
  if (!adminChatIds.includes(adminChatId.toString())) return;

  const targetChatId = match[1];
  bannedUsers[targetChatId] = true;

  bot.sendMessage(adminChatId, `User with ID ${targetChatId} has been banned.`);
  bot.sendMessage(targetChatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*', { parse_mode: 'Markdown' });
});

// Admin command to unban a user
bot.onText(/\/unban (.+)/, (msg, match) => {
  const adminChatId = msg.chat.id;
  if (!adminChatIds.includes(adminChatId.toString())) return;

  const targetChatId = match[1];
  delete bannedUsers[targetChatId];

  bot.sendMessage(adminChatId, `User with ID ${targetChatId} has been unbanned.`);
});

// Admin command to view banned users
bot.onText(/\/banned/, (msg) => {
  const adminChatId = msg.chat.id;
  if (!adminChatIds.includes(adminChatId.toString())) return;

  const bannedList = Object.keys(bannedUsers).join('\n') || 'No users are currently banned.';
  bot.sendMessage(adminChatId, `Banned Users:\n${bannedList}`);
});

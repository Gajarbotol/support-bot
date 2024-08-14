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

  // Send the language selection message without deleting the previous message
  bot.sendMessage(chatId, responseMessage, {
    reply_markup: {
      inline_keyboard: [
        [{ text: optionLabels.channel, url: 'https://t.me/your_channel' }],
        [{ text: optionLabels.customerService, callback_data: 'customer_service' }]
      ]
    }
  });
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

        bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*Full Name:* ${userFullName}\n*Provided Name:* ${userProvidedName}\n*ID:* ${chatId}\n*Language:* ${language}`, options);
      });
    });

    bot.sendMessage(chatId, '*Your request has been sent to customer support. Please wait for a response.*', { parse_mode: 'Markdown' });
    delete awaitingName[chatId];
  } else if (activeChats[chatId]) {
    const recipientChatId = activeChats[chatId];
    bot.sendMessage(recipientChatId, msg.text);
  } else if (adminChatIds.includes(chatId.toString())) {
    return; // Admins should not be able to use this section of the bot
  } else if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, '*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
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
  } else if (action === 'start') {
    activeChats[chatId] = adminChatId;
    activeChats[adminChatId] = chatId;

    bot.sendMessage(chatId, '*একজন প্রশাসক আপনার সাথে সংযুক্ত হয়েছে। আপনি আর কথোপকথন বন্ধ করতে পারবেন না।*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*আপনি এখন এই ব্যবহারকারীর সাথে সংযুক্ত।*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Stop Conversation', callback_data: `stop_${chatId}` }]
        ]
      }
    });
  } else if (action === 'stop') {
    bot.sendMessage(chatId, '*প্রশাসক দ্বারা কথোপকথন শেষ করা হয়েছে।*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*কথোপকথন শেষ হয়েছে।*', { parse_mode: 'Markdown' });

    delete activeChats[chatId];
    delete activeChats[adminChatId];
  }
});

// Admin commands

// /list command to list all active chats
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;

  if (adminChatIds.includes(chatId.toString())) {
    let activeChatsList = '*সক্রিয় চ্যাটগুলো:*\n';
    Object.keys(activeChats).forEach((userChatId) => {
      if (!adminChatIds.includes(userChatId)) {
        activeChatsList += `\n*ব্যবহারকারীর আইডি:* ${userChatId}`;
      }
    });

    if (activeChatsList === '*সক্রিয় চ্যাটগুলো:*\n') {
      activeChatsList += '\nকোনও সক্রিয় চ্যাট নেই।';
    }

    bot.sendMessage(chatId, activeChatsList, { parse_mode: 'Markdown' });
  }
});

// /ban command to ban a user
bot.onText(/\/ban (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userToBan = match[1];

  if (adminChatIds.includes(chatId.toString())) {
    bannedUsers[userToBan] = true;
    bot.sendMessage(chatId, `*ব্যবহারকারী ${userToBan} নিষিদ্ধ করা হয়েছে।*`, { parse_mode: 'Markdown' });
  }
});

// /unban command to unban a user
bot.onText(/\/unban (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userToUnban = match[1];

  if (adminChatIds.includes(chatId.toString())) {
    delete bannedUsers[userToUnban];
    bot.sendMessage(chatId, `*ব্যবহারকারী ${userToUnban} নিষেধাজ্ঞা তুলে নেওয়া হয়েছে।*`, { parse_mode: 'Markdown' });
  }
});

// /banned command to list all banned users
bot.onText(/\/banned/, (msg) => {
  const chatId = msg.chat.id;

  if (adminChatIds.includes(chatId.toString())) {
    let bannedUsersList = '*নিষিদ্ধ ব্যবহারকারীগণ:*\n';
    Object.keys(bannedUsers).forEach((user) => {
      bannedUsersList += `\n*ব্যবহারকারীর আইডি:* ${user}`;
    });

    if (bannedUsersList === '*নিষিদ্ধ ব্যবহারকারীগণ:*\n') {
      bannedUsersList += '\nকোনও নিষিদ্ধ ব্যবহারকারী নেই।';
    }

    bot.sendMessage(chatId, bannedUsersList, { parse_mode: 'Markdown' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running');
});

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const app = express();

const token = process.env.TELEGRAM_BOT_TOKEN; // Use environment variable for bot token
const adminChatIds = [process.env.ADMIN_CHAT_ID_1]; // Use environment variables for admin chat IDs

const bot = new TelegramBot(token, { polling: true });

const bannedUsers = {}; // To store banned users
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

// Handle start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

  // Check if the user is banned
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*\n*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
    return;
  }

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
    bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*\n*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
    return;
  }

  let responseMessage = '';
  let optionLabels = { channel: '', customerService: '' };
  if (callbackQuery.data === 'language_bn') {
    responseMessage = '*আপনি বাংলা ভাষা নির্বাচন করেছেন।*\n\nঅনুগ্রহ করে আপনার পছন্দের অপশন নির্বাচন করুন:';
    optionLabels.channel = 'আমাদের চ্যানেল জয়েন করুন';
    optionLabels.customerService = 'কাস্টমার সার্ভিস';
  } else if (callbackQuery.data === 'language_en') {
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

  // Send the language selection message
  bot.sendMessage(chatId, responseMessage, options);
});

// Handle customer service request
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  if (callbackQuery.data === 'customer_service') {
    awaitingName[chatId] = true;
    bot.sendMessage(chatId, '*অনুগ্রহ করে লাইভ চ্যাট চালিয়ে যাওয়ার জন্য আপনার নাম লিখুন।*\n\n*Please enter your name to continue the live chat.*', { parse_mode: 'Markdown' });
  }
});

// Handle incoming user messages and forward them to the assigned admin only if the conversation is active
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username ? `@${msg.from.username}` : "N/A";
  const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

  // Check if the user is in an active chat with an admin
  if (activeChats[chatId]) {
    const adminChatId = activeChats[chatId];

    // Forward the user's message to the admin if the chat is active
    bot.forwardMessage(adminChatId, chatId, msg.message_id);
  } else if (awaitingName[chatId]) {
    // Logic for handling name input
    const userProvidedName = msg.text.trim();

    // Notify the admins with all the details
    adminChatIds.forEach((adminChatId) => {
      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Deny', callback_data: `deny_${chatId}` }],
            [{ text: 'Start Conversation', callback_data: `start_${chatId}` }]
          ]
        }
      };

      // Adding more information about the user in the request
      bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*User Provided Name:* ${userProvidedName}\n*Full Name:* ${userFullName}\n*Username:* ${username}\n*User ID:* ${chatId}`, options);
    });

    bot.sendMessage(chatId, '*Your request has been sent to customer service. Please wait for a response.*', { parse_mode: 'Markdown' });
    delete awaitingName[chatId];
  } else if (adminChatIds.includes(chatId.toString())) {
    // Logic for handling messages from admins can go here
  } else if (bannedUsers[chatId]) {
    // If the user is banned, notify them
    bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*\n*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
  }
});

// Handle admin responses to live chat requests
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const adminChatId = message.chat.id;
  const actionData = callbackQuery.data.split('_');
  const action = actionData[0];
  const chatId = actionData[1];

  if (action === 'start') {
    // Mark the conversation as active
    activeChats[chatId] = adminChatId;
    activeChats[adminChatId] = chatId;

    bot.sendMessage(chatId, '*একজন প্রশাসক আপনার সাথে সংযুক্ত হয়েছে। আপনি এখন চ্যাট করতে পারবেন।*\n\n*An admin has connected with you. You can now chat.*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*আপনি এখন এই ব্যবহারকারীর সাথে সংযুক্ত আছেন।*\n\n*You are now connected with this user.*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'কথোপকথন বন্ধ করুন / Stop Conversation', callback_data: `stop_${chatId}` }]
        ]
      }
    });
  } else if (action === 'stop') {
    // End the active conversation
    bot.sendMessage(chatId, '*প্রশাসক দ্বারা কথোপকথন শেষ করা হয়েছে।*\n\n*The conversation has been ended by the admin.*', { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, '*কথোপকথন শেষ হয়েছে।*\n\n*The conversation has ended.*', { parse_mode: 'Markdown' });

    // Remove the active chat entry
    delete activeChats[chatId];
    delete activeChats[adminChatId];
  } else if (action === 'deny') {
    bot.sendMessage(chatId, '*আপনার লাইভ চ্যাট অনুরোধটি প্রশাসক দ্বারা প্রত্যাখ্যান করা হয়েছে।*\n\n*Your live chat request has been denied by the admin.*', { parse_mode: 'Markdown' });
  }
});

// Admin commands

// /list command to list all active chats
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;

  if (adminChatIds.includes(chatId.toString())) {
    let activeChatsList = '*সক্রিয় চ্যাটগুলো / Active Chats:*\n';
    Object.keys(activeChats).forEach((userChatId) => {
      if (!adminChatIds.includes(userChatId)) {
        activeChatsList += `User ID: ${userChatId} -> Admin ID: ${activeChats[userChatId]}\n`;
      }
    });
    bot.sendMessage(chatId, activeChatsList, { parse_mode: 'Markdown' });
  }
});

// /ban command to ban a user
bot.onText(/\/ban (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;

  if (adminChatIds.includes(chatId.toString())) {
    const userIdToBan = match[1];
    bannedUsers[userIdToBan] = true;
    bot.sendMessage(chatId, `*ব্যবহারকারী নিষিদ্ধ করা হয়েছে।*\n\n*User ${userIdToBan} has been banned.*`, { parse_mode: 'Markdown' });
  }
});

// /unban command to unban a user
bot.onText(/\/unban (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;

  if (adminChatIds.includes(chatId.toString())) {
    const userIdToUnban = match[1];
    delete bannedUsers[userIdToUnban];
    bot.sendMessage(chatId, `*ব্যবহারকারী নিষেধাজ্ঞা প্রত্যাহার করা হয়েছে।*\n\n*User ${userIdToUnban} has been unbanned.*`, { parse_mode: 'Markdown' });
  }
});

// Express server setup to keep the bot running
app.get('/', (req, res) => {
  res.send('Telegram bot is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

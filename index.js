const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const express = require('express');
const app = express();

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatIds = [process.env.ADMIN_CHAT_ID_1, process.env.ADMIN_CHAT_ID_2];

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://user-storage-74dd4-default-rtdb.firebaseio.com/'
});

const db = admin.database();
const bot = new TelegramBot(token, { polling: true });

const bannedUsers = {};
const lastReplyTimes = {};
const activeChats = {};

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

const saveUser = (chatId, userFullName, username) => {
  db.ref(`users/${chatId}`).set({
    name: userFullName,
    username: username
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
  const username = msg.from.username || '';

  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, '*You are banned from using this bot.*', { parse_mode: 'Markdown' });
    return;
  }

  saveUser(chatId, userFullName, username);

  const greeting = getBangladeshGreeting();
  const greetingMessage = `${greeting} ${userFullName}!`;
  const languageMessage = `Please select your preferred language:\n\nঅনুগ্রহ করে আপনার পছন্দের ভাষা নির্বাচন করুন:`;

  bot.sendMessage(chatId, greetingMessage).then(() => {
    bot.sendMessage(chatId, languageMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'বাংলা', callback_data: 'language_bn' }],
          [{ text: 'English', callback_data: 'language_en' }]
        ]
      }
    }).then((langMsg) => {
      bot.on('callback_query', (callbackQuery) => {
        const chatId = callbackQuery.message.chat.id;

        if (bannedUsers[chatId]) {
          bot.sendMessage(chatId, '*You are banned from using this bot.*', { parse_mode: 'Markdown' });
          return;
        }

        let responseMessage = '';
        if (callbackQuery.data === 'language_bn') {
          db.ref(`users/${chatId}`).update({ language: 'bn' });
          responseMessage = '*আপনি বাংলা ভাষা নির্বাচন করেছেন।*\n\nঅনুগ্রহ করে আপনার পছন্দের অপশন নির্বাচন করুন:';
        } else if (callbackQuery.data === 'language_en') {
          db.ref(`users/${chatId}`).update({ language: 'en' });
          responseMessage = '*You have selected English.*\n\nPlease select your preferred option:';
        }

        bot.deleteMessage(chatId, langMsg.message_id); // Delete the language selection message

        bot.sendMessage(chatId, responseMessage, {
          reply_markup: {
            inline_keyboard: [
              [{ text: callbackQuery.data === 'language_bn' ? 'আমাদের চ্যানেল জয়েন করুন' : 'Join Our Channel', url: 'https://t.me/your_channel' }],
              [{ text: callbackQuery.data === 'language_bn' ? 'কাস্টমার সার্ভিস' : 'Customer Service', callback_data: 'customer_service' }]
            ]
          }
        });
      });
    });
  });
});

bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const chatId = message.chat.id;

  if (callbackQuery.data === 'customer_service') {
    bot.sendMessage(chatId, 'Please enter your name:').then((nameMsg) => {
      bot.once('message', (msg) => {
        const userName = msg.text;

        db.ref(`users/${chatId}`).once('value', (snapshot) => {
          const userInfo = snapshot.val();
          const userFullName = userInfo.name;
          const language = userInfo.language;

          adminChatIds.forEach((adminChatId) => {
            bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*User:* ${userFullName}\n*Username:* ${userName}\n*ID:* ${chatId}\n*Language:* ${language}`, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: 'Deny', callback_data: `deny_${chatId}` }],
                  [{ text: 'Start Conversation', callback_data: `start_chat_${chatId}` }]
                ]
              }
            });
          });

          bot.sendMessage(chatId, '*Your request has been sent to customer service. Please wait for a response.*', { parse_mode: 'Markdown' });
          bot.deleteMessage(chatId, nameMsg.message_id); // Delete the name request message
        });
      });
    });
  }
});

// Handle admin responses to live chat requests
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const adminChatId = message.chat.id;
  const actionData = callbackQuery.data.split('_');
  const action = actionData[0];
  const userChatId = actionData[1];

  if (action === 'deny') {
    bot.sendMessage(userChatId, '*Your request has been denied by customer service.*', { parse_mode: 'Markdown' });
    bot.deleteMessage(adminChatId, message.message_id); // Delete the denial message
  } else if (action === 'start_chat') {
    activeChats[adminChatId] = userChatId;
    activeChats[userChatId] = adminChatId;

    bot.sendMessage(userChatId, '*Customer service has started a conversation with you.*', { parse_mode: 'Markdown' });

    const options = {
      reply_markup: {
        keyboard: [['Stop Conversation']],
        one_time_keyboard: true
      }
    };

    bot.sendMessage(adminChatId, '*You have started a conversation with the user. To stop, click the button below.*', options);
    bot.deleteMessage(adminChatId, message.message_id); // Delete the start conversation message
  }
});

// Handle messages in active chat sessions
bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  if (activeChats[chatId]) {
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
    // Regular message handling as before
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

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

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
const activeChats = {}; // To store active chat sessions

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

    // Delete the language selection message
    bot.deleteMessage(chatId, message.message_id).catch((error) => {
        console.error('Failed to delete message:', error);
    });

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

    // Delete the customer service selection message
    bot.deleteMessage(chatId, message.message_id).catch((error) => {
        console.error('Failed to delete message:', error);
    });

    if (callbackQuery.data === 'customer_service') {
        db.ref(`users/${chatId}`).once('value', (snapshot) => {
            const userInfo = snapshot.val();
            const userFullName = userInfo.name;
            const language = userInfo.language;

            adminChatIds.forEach((adminChatId) => {
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Deny', callback_data: `deny_${chatId}` }],
                            [{ text: 'Start Conversation', callback_data: `start_chat_${chatId}` }]
                        ]
                    }
                };

                bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*User:* ${userFullName}\n*ID:* ${chatId}\n*Language:* ${language}`, options);
            });
        });

        bot.sendMessage(chatId, '*Your request has been sent to customer service. Please wait for a response.*', { parse_mode: 'Markdown' });
    }
});

// Handle admin responses to live chat requests
bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const adminChatId = message.chat.id;
    const actionData = callbackQuery.data.split('_');
    const action = actionData[0];
    const userChatId = actionData[1];

    // Delete the message after admin makes a selection
    bot.deleteMessage(adminChatId, message.message_id).catch((error) => {
        console.error('Failed to delete message:', error);
    });

    if (action === 'deny') {
        bot.sendMessage(userChatId, '*Your request has been denied by customer service.*', { parse_mode: 'Markdown' });
    } else if (action === 'start_chat') {
        activeChats[adminChatId] = userChatId;
        activeChats[userChatId] = adminChatId;

        // Notify the user that the conversation has started and prompt them to send a message
        bot.sendMessage(userChatId, '*Customer service has started a conversation with you.*\n\nPlease send your message below:', { parse_mode: 'Markdown' });

        // Notify the admin that the conversation has started
        const options = {
            reply_markup: {
                keyboard: [['Stop Conversation']],
                one_time_keyboard: true
            }
        };

        bot.sendMessage(adminChatId, '*You have started a conversation with the user. To stop, click the button below.*', options);
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
        }
    }
});

// Ban command for admins to ban users
bot.onText(/\/ban (\d+)/, (msg, match) => {
    const adminChatId = msg.chat.id;
    const userChatId = match[1];

    if (adminChatIds.includes(adminChatId.toString())) {
        bannedUsers[userChatId] = true;
        bot.sendMessage(adminChatId, `*User with ID ${userChatId} has been banned.*`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(adminChatId, '*You do not have permission to use this command.*', { parse_mode: 'Markdown' });
    }
});

// Unban command for admins to unban users
bot.onText(/\/unban (\d+)/, (msg, match) => {
    const adminChatId = msg.chat.id;
    const userChatId = match[1];

    if (adminChatIds.includes(adminChatId.toString())) {
        delete bannedUsers[userChatId];
        bot.sendMessage(adminChatId, `*User with ID ${userChatId} has been unbanned.*`, { parse_mode: 'Markdown' });
    } else {
        bot.sendMessage(adminChatId, '*You do not have permission to use this command.*', { parse_mode: 'Markdown' });
    }
});

// Express server for health check
app.get('/', (req, res) => {
    res.send('Telegram bot is running.');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Telegram bot server is running on port ${port}`);
});

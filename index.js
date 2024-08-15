const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');
const app = express();

const token = '7245291358:AAGRhwVievYbQCRSQ3LO-9yVG21P_gcgWu4';
const adminChatIds = ['5197344486'];

const bot = new TelegramBot(token, { polling: true });

const bannedUsers = {};
const activeChats = {};
const awaitingName = {};

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

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

    if (bannedUsers[chatId]) {
        bot.sendMessage(chatId, '*আপনি এই বট ব্যবহার থেকে নিষিদ্ধ হয়েছেন।*\n*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
        return;
    }

    const greeting = getBangladeshGreeting();
    const greetingMessage = `${greeting}, ${userFullName}!`;

    bot.sendMessage(chatId, greetingMessage);

    const languageMessage = `Please select your preferred language:\n\nঅনুগ্রহ করে আপনার পছন্দের ভাষা নির্বাচন করুন:`;

    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'বাংলা', callback_data: 'language_bn' }],
                [{ text: 'English', callback_data: 'language_en' }]
            ]
        }
    };

    bot.sendMessage(chatId, languageMessage, options);
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;

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

    bot.sendMessage(chatId, responseMessage, options);
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;

    if (callbackQuery.data === 'customer_service') {
        awaitingName[chatId] = true;
        bot.sendMessage(chatId, '*অনুগ্রহ করে লাইভ চ্যাট চালিয়ে যাওয়ার জন্য আপনার নাম লিখুন।*\n\n*Please enter your name to continue the live chat.*', { parse_mode: 'Markdown' });
    }
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : "N/A";
    const userFullName = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();

    if (activeChats[chatId]) {
        const adminChatId = activeChats[chatId];

        if (adminChatIds.includes(chatId.toString())) {
            bot.sendMessage(adminChatId, `${msg.text}`, { parse_mode: 'Markdown' });
        } else {
            bot.forwardMessage(adminChatId, chatId, msg.message_id);
        }
    } else if (awaitingName[chatId]) {
        const userProvidedName = msg.text.trim();

        adminChatIds.forEach((adminChatId) => {
            const options = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Deny', callback_data: `deny_${chatId}` }],
                        [{ text: 'Start Conversation', callback_data: `start_${chatId}` }]
                    ]
                }
            };

            bot.sendMessage(adminChatId, `*New Live Chat Request*\n\n*User Provided Name:* ${userProvidedName}\n*Full Name:* ${userFullName}\n*Username:* ${username}\n*User ID:* ${chatId}`, options);
        });

        bot.sendMessage(chatId, '*Your request has been sent to customer service. Please wait for a response. \n\nআপনার রিকোয়েস্ট সফলভাবে পাঠানো হয়েছে। দয়া করে অপেক্ষা করুন*', { parse_mode: 'Markdown' });
        delete awaitingName[chatId];
    } else if (bannedUsers[chatId]) {
        bot.sendMessage(chatId, '*You have been banned from using this bot.*', { parse_mode: 'Markdown' });
    }
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const adminChatId = message.chat.id;
    const actionData = callbackQuery.data.split('_');
    const action = actionData[0];
    const chatId = actionData[1];

    if (action === 'start') {
        activeChats[chatId] = adminChatId;
        activeChats[adminChatId] = chatId;

        bot.sendMessage(chatId, '*An admin has connected with you. You can now chat.*', { parse_mode: 'Markdown' });
        bot.sendMessage(adminChatId, '*You are now connected with this user.*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Stop Conversation', callback_data: `stop_${chatId}` }]
                ]
            }
        });
    } else if (action === 'stop') {
        bot.sendMessage(chatId, '*The conversation has been ended by the admin.*', { parse_mode: 'Markdown' });
        bot.sendMessage(adminChatId, '*The conversation has ended.*', { parse_mode: 'Markdown' });

        delete activeChats[chatId];
        delete activeChats[adminChatId];
    } else if (action === 'deny') {
        bot.sendMessage(chatId, '*Your live chat request has been denied by the admin.*', { parse_mode: 'Markdown' });
    }
});

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

bot.onText(/\/ban (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1];

    if (adminChatIds.includes(chatId.toString())) {
        bannedUsers[userId] = true;
        bot.sendMessage(chatId, `*User with ID ${userId} has been banned.*`, { parse_mode: 'Markdown' });
    }
});

bot.onText(/\/unban (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1];

    if (adminChatIds.includes(chatId.toString())) {
        delete bannedUsers[userId];
        bot.sendMessage(chatId, `*User with ID ${userId} has been unbanned.*`, { parse_mode: 'Markdown' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

const keepAlive = () => {
    const url = `https://<your-app-name>.onrender.com`;
    axios.get(url)
        .then(() => {
            console.log('Keep Alive Ping Successful');
        })
        .catch((error) => {
            console.error('Keep Alive Ping Failed:', error.message);
        });
};

setInterval(keepAlive, 300000);

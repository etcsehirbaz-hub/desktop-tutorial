const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ⚠️ TIKTOK İSTİFADƏÇİ ADIN
const TIKTOK_USERNAME = "@sumgayit.music"; 

let regions = {};
let timerInterval = null;
let timeLeft = 0;
let isGameActive = false;

// 🎁 REAL TIKTOK ADLARINA GÖRƏ TAM DÜZƏLDİLMİŞ HƏDİYYƏ SİYAHISI
const SIMPLE_GIFT_LIST = [
    { giftName: "rose", img: "/gifts/rose.png", displayName: "Qızılgül", value: 1, pts: 10 },          
    { giftName: "ice cream cone", img: "/gifts/ice_cream.png", displayName: "Dondurma", value: 1, pts: 10 },  
    { giftName: "tiktok", img: "/gifts/tiktok.png", displayName: "TikTok", value: 1, pts: 10 },        
    { giftName: "gg", img: "/gifts/gg.png", displayName: "GG", value: 1, pts: 10 },            
    { giftName: "heart puff", img: "/gifts/Heart_Puff.png", displayName: "Şirin Ürək", value: 1, pts: 10 }, 
    { giftName: "cake slice", img: "/gifts/Birthday_Cake.png", displayName: "Kəsilmiş Tort", value: 1, pts: 10 }            
];

let giftIndexCounter = 0;
let tiktokConnection = new WebcastPushConnection(TIKTOK_USERNAME);

// 🛠️ MÜTLƏQ DUBBLİKAT BLOKLAYICI MEXANİZM
let processedMsgIds = new Map();
let userGiftStreaks = new Map(); // İstifadəçilərin son kombo sayını izləmək üçün

// 🎁 DONORLARI (HƏDİYYƏ ATANLARI) YADDA SAXLAMAQ ÜÇÜN SİYAHI
let donorList = [];

async function connectToTikTok() {
    try { 
        await tiktokConnection.connect(); 
        console.log(`[TikTok] Hədiyyə və Şərh sistema uğurla aktiv edildi!`);
    } catch (err) {
        console.log('[TikTok] Canlı yayım bağlantısı gözlənilir...');
    }
}
connectToTikTok();

function cleanKey(text) {
    if (!text) return "";
    return text.trim().toLowerCase()
        .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ö/g, 'o')
        .replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ç/g, 'c');
}

function moveHorse(key, points) {
    if (!regions[key]) return; 
    regions[key].score += points;
    io.emit('update-game', { regions });
}

// 1. HƏDİYYƏ GƏLƏNDƏ (YENİLƏNMİŞ QÜSURSUZ KOMBO MEXANİKASI)
tiktokConnection.on('gift', data => {
    let msgId = data.msgId;
    let userId = data.userId;
    let liveGiftName = data.giftName.trim().toLowerCase().replace(/\s+/g, ''); 
    let currentRepeatCount = data.repeatCount;
    let now = Date.now();

    // ⛔ SƏDD 1: Tamamilə eyni paket təkrar gəlibsə dərhal rədd et!
    if (msgId && processedMsgIds.has(msgId)) {
        return;
    }
    if (msgId) {
        processedMsgIds.set(msgId, now);
    }

    // ⛔ SƏDD 2: Ağıllı Kombo Diferensial Hesablama Sistemi
    let streakKey = `${userId}_${liveGiftName}`;
    let previousStreak = userGiftStreaks.get(streakKey);
    let incomingPointsCount = 0;

    if (previousStreak) {
        // Əgər kombo sayı əvvəlkindən kiçik və ya bərabərdirsə VƏ çox qısa müddətdə gəlibsə, dublikatdır
        if (currentRepeatCount <= previousStreak.count && (now - previousStreak.time < 1500)) {
            return;
        }
        
        if (currentRepeatCount > previousStreak.count) {
            // Kombo artırsa, aradakı real fərqi hesablayırıq
            incomingPointsCount = currentRepeatCount - previousStreak.count;
        } else {
            // Yeni kombo zənciri başlayıbsa
            incomingPointsCount = currentRepeatCount;
        }
    } else {
        // İlk dəfə gələn müstəqil hədiyyədirsə
        incomingPointsCount = currentRepeatCount;
    }

    // Cari vəziyyəti yaddaşda yeniləyirik
    userGiftStreaks.set(streakKey, { count: currentRepeatCount, time: now });

    if (incomingPointsCount <= 0) return;

    for (let key in regions) {
        let assignedGift = regions[key].gift;
        let cleanAssignedName = assignedGift.giftName.trim().toLowerCase().replace(/\s+/g, '');

        if (cleanAssignedName === liveGiftName) {
            
            // Xal Hesablanması: Hədiyyə xalı * Yeni gələn real hədiyyə miqdarı
            let totalPts = assignedGift.pts * incomingPointsCount; 

            console.log(`[HƏDİYYƏ HESABLANDI] ${regions[key].name} +${totalPts} Xal (Sayı: x${incomingPointsCount}).`);
            moveHorse(key, totalPts);

            io.emit('gift-alert', {
                username: data.uniqueId,
                nickname: data.nickname,
                profilePic: data.profilePictureUrl,
                giftName: assignedGift.displayName,
                giftImg: assignedGift.img,
                count: incomingPointsCount,
                regionName: regions[key].name
            });

            // 🎁 TOP DONORLAR SİYAHISININ DƏQİQ ARTIMI
            let existingDonor = donorList.find(d => d.username === data.uniqueId);
            if (existingDonor) {
                existingDonor.count += incomingPointsCount; 
            } else {
                donorList.unshift({
                    username: data.uniqueId,
                    nickname: data.nickname,
                    profilePic: data.profilePictureUrl || 'https://www.tiktok.com/favicon.ico',
                    giftImg: assignedGift.img,
                    count: incomingPointsCount
                });
            }

            if (donorList.length > 10) donorList.pop();
            io.emit('update-donors', donorList);

            break;
        }
    }
});

// Yaddaşı təmizləmək üçün kiçik təmizlik dövrü
setInterval(() => {
    let now = Date.now();
    // Kombo keş yaddaş təmizliyi
    for (let [k, streak] of userGiftStreaks.entries()) {
        if (now - streak.time > 30000) userGiftStreaks.delete(k);
    }
    // MsgId yaddaş təmizliyi
    for (let [id, time] of processedMsgIds.entries()) {
        if (now - time > 15000) processedMsgIds.delete(id);
    }
}, 10000);

// 2. ŞƏRH (CHAT) YAZILANDA (+1 XAL)
tiktokConnection.on('chat', data => {
    let message = data.comment; 
    if (!message) return;

    for (let key in regions) {
        let cleanedRegionName = cleanKey(regions[key].name); 
        let cleanedMessage = cleanKey(message);             

        if (cleanedMessage.includes(cleanedRegionName)) {
            console.log(`[ŞƏRH] ${data.uniqueId} -> ${regions[key].name} yazdı! (+1 Xal)`);
            moveHorse(key, 1); 
            break; 
        }
    }
});

io.on('connection', (socket) => {
    socket.emit('init-regions', { regions, timeLeft, isGameActive });
    
    // 🌟 YENİ SƏHİFƏ AÇILANDA KÖHNƏ ATANLARIN SİYAHISINI ANINDA GÖNDƏR
    socket.emit('update-donors', donorList);

    socket.on('add-region', (regionName) => {
        let key = cleanKey(regionName);
        if (Object.keys(regions).length >= 6) return; 
        
        if (key && !regions[key]) {
            let selectedGift = SIMPLE_GIFT_LIST[giftIndexCounter % SIMPLE_GIFT_LIST.length];
            giftIndexCounter++;

            regions[key] = { 
                name: regionName, 
                score: 0,
                gift: selectedGift
            }; 
            io.emit('init-regions', { regions, timeLeft, isGameActive });
        }
    });

    socket.on('delete-region', (key) => {
        if (regions[key]) { delete regions[key]; io.emit('init-regions', { regions, timeLeft, isGameActive }); }
    });

    socket.on('start-timer', (minutes) => {
        if (isGameActive) return;
        isGameActive = true;
        timeLeft = minutes * 60;
        timerInterval = setInterval(() => {
            timeLeft--;
            io.emit('timer-update', timeLeft);
            if (timeLeft <= 0) {
                isGameActive = false;
                clearInterval(timerInterval);
                let winner = null; let maxScore = -1;
                for (let k in regions) { if (regions[k].score > maxScore) { maxScore = regions[k].score; winner = regions[k]; } }
                io.emit('game-over', winner);
            }
        }, 1000);
    });

    socket.on('reset-game', () => {
        clearInterval(timerInterval); isGameActive = false; timeLeft = 0;
        for (let key in regions) { regions[key].score = 0; }
        io.emit('init-regions', { regions, timeLeft, isGameActive });
    });
});

server.listen(3000, () => { console.log('HƏDİYYƏ, ŞƏRH VƏ ANİMASİYA SİSTEMLİ SERVER START OLUNDU'); });
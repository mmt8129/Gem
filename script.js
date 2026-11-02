// ==================== KONFIGÜRASYON ====================
const GEMINI_PROXY_URL = "https://imdb-gemini.06mmt8129.workers.dev";

const fbCfg = {
    apiKey: "AIzaSyBr57bmspJo8r_4IdkBNI_DhULYf0ynCQs",
    databaseURL: "https://gen-lang-client-0253857481-default-rtdb.firebaseio.com",
    projectId: "gen-lang-client-0253857481"
};

if (!firebase.apps.length) firebase.initializeApp(fbCfg);
const db = firebase.database();

// ==================== STATE ====================
let news = [];
let rssListesi = {};
let currentCategory = 'all';
let newsLimit = parseInt(localStorage.getItem('haberai_news_limit') || '10');
let visibleCount = newsLimit;
let savedNews = JSON.parse(localStorage.getItem('haberai_saved') || '[]');
let currentDetailNews = null;
let detailStarred = false;
let dropdownOpen = false;
let carouselIndex = 0;
let modalStack = [];
let disabledSources = JSON.parse(localStorage.getItem('haberai_disabled_sources') || '[]');

// AI Değişkenleri
let aiChatHistory = [];
let currentQuery = ""; 

let selectedDateFilter = null;
let tempSelectedDate = null;
let calendarViewDate = new Date();
let weatherDailyData = [];
let weatherCurrentData = null;

// ==================== YARDIMCILAR ====================
function timeAgo(ds) {
    if (!ds) return '';
    const diff = (new Date() - new Date(ds)) / 60000;
    if (diff < 1) return 'Az önce';
    if (diff < 60) return Math.floor(diff) + ' dk önce';
    if (diff < 1440) return Math.floor(diff / 60) + ' sa önce';
    return new Date(ds).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function getRecentNews(arr) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 5);
    return arr.filter(n => {
        const d = new Date(n.date);
        return !isNaN(d.getTime()) && d >= cutoff;
    });
}

function updateSavedBadge() {
    const badge = document.getElementById('savedBadge');
    if (badge) {
        if (savedNews.length > 0) { badge.style.display = 'inline-block'; badge.textContent = savedNews.length; }
        else { badge.style.display = 'none'; }
    }
}

function dateKey(d) {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function metniTemizle(hamMetin) {
    let temiz = String(hamMetin || '');
    temiz = temiz.replace(/【[^】]*】/g, '').replace(/\[\d+†[^\]]*\]/g, '').replace(/\[\d+\]/g, '');
    temiz = temiz.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    temiz = temiz.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
    temiz = temiz.replace(/\*\*(.*?)\*\*/g, '<b style="color:var(--primary);">$1</b>');
    temiz = temiz.replace(/^#{1,6}\s+(.*)$/gm, '<b style="color:var(--primary);">$1</b>');
    temiz = temiz.replace(/^\s*[\-\*]\s+/gm, '• ');
    temiz = temiz.replace(/\n/g, '<br>');
    return temiz;
}

async function callGemini(text) {
    const res = await fetch(GEMINI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text }] }]
        })
    });
    if (!res.ok) throw new Error('Gemini ' + res.status);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Cevap alınamadı.';
}

// ==================== MODAL STACK ====================
function pushModal(type, data) { modalStack.push({ type, ...data }); history.pushState({ modal: true }, '', location.href); }
function popModal() {
    if (modalStack.length > 0) {
        modalStack.pop();
        if (modalStack.length > 0) { history.pushState({ modal: true }, '', location.href); }
        else { history.back(); }
        return true;
    }
    return false;
}
function closeTopModal() {
    if (modalStack.length === 0) return;
    const top = modalStack[modalStack.length - 1];
    switch (top.type) {
        case 'ai': closeAIModal(false); break;
        case 'search': closeSearchModal(false); break;
        case 'settings': closeSettingsModal(false); break;
        case 'rss': closeRSSModal(false); break;
        case 'saved': closeSavedModal(false); break;
        case 'confirm': closeConfirmModal(false); break;
        case 'detailSheet': closeDetailSheet(false); break;
        case 'detail': closeDetail(false); break;
        case 'weather': closeWeatherModal(false); break;
        case 'calendar': closeCalendarModal(false); break;
        default: popModal();
    }
}
history.pushState({ modal: false }, '', location.href);
window.addEventListener('popstate', function(e) {
    if (modalStack.length > 0) {
        const top = modalStack[modalStack.length - 1];
        switch (top.type) {
            case 'ai': closeAIModal(false); break;
            case 'search': closeSearchModal(false); break;
            case 'settings': closeSettingsModal(false); break;
            case 'rss': closeRSSModal(false); break;
            case 'saved': closeSavedModal(false); break;
            case 'confirm': closeConfirmModal(false); break;
            case 'detailSheet': closeDetailSheet(false); break;
            case 'detail': closeDetail(false); break;
            case 'weather': closeWeatherModal(false); break;
            case 'calendar': closeCalendarModal(false); break;
            default: popModal(); history.pushState({ modal: false }, '', location.href);
        }
        if (modalStack.length > 0) { history.pushState({ modal: true }, '', location.href); }
    } else if (document.getElementById('detailPage').style.display === 'flex') {
        closeDetail(false);
        history.pushState({ modal: false }, '', location.href);
    }
});

// ==================== HABER ÇEKME ====================
async function fetchAllNews(isManual = false) {
    const proxyUrl = "https://wild-sky-08d7.06mmt8129.workers.dev/?url=";
    if (!isManual) {
        const cachedData = localStorage.getItem('haberai_news_cache');
        if (cachedData) { news = JSON.parse(cachedData); renderAll(); return; }
        if (Object.keys(rssListesi).length === 0) {
            document.getElementById('newsListMount').innerHTML = '<div class="empty-state">Henüz RSS kaynağı eklenmemiş. Ayarlardan ekleyebilirsiniz.</div>';
        } else {
            document.getElementById('newsListMount').innerHTML = '<div class="empty-state">Haberler için üstteki 🔄 butonuna basın.</div>';
        }
        return;
    }
    news = [];
    if (Object.keys(rssListesi).length === 0) {
        document.getElementById('newsListMount').innerHTML = '<div class="empty-state">Henüz RSS kaynağı eklenmemiş. Ayarlardan ekleyebilirsiniz.</div>';
        return;
    }
    document.getElementById('newsListMount').innerHTML = '<div style="text-align:center;padding:50px;color:var(--text-muted);font-style:italic;">Haberler yükleniyor...</div>';
    for (const id in rssListesi) {
        const rss = rssListesi[id];
        if (disabledSources.includes(id)) continue;
        try {
            const response = await fetch(proxyUrl + encodeURIComponent(rss.url));
            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "text/xml");
            const items = xmlDoc.querySelectorAll("item, entry");
            items.forEach((el) => {
                const title = el.querySelector("title")?.textContent || "";
                let link = el.querySelector("link")?.textContent || el.querySelector("link")?.getAttribute("href") || "";
                const date = el.querySelector("pubDate")?.textContent || el.querySelector("dc\\:date")?.textContent || el.querySelector("date")?.textContent || "";
                let img = "";
                const mediaContent = el.querySelector("media\\:content") || el.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "content")[0];
                if (mediaContent) img = mediaContent.getAttribute("url") || mediaContent.getAttribute("src") || "";
                if (!img) {
                    const mediaThumb = el.querySelector("media\\:thumbnail") || el.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "thumbnail")[0];
                    if (mediaThumb) img = mediaThumb.getAttribute("url") || mediaThumb.getAttribute("src") || "";
                }
                if (!img) {
                    const enclosure = el.querySelector("enclosure");
                    if (enclosure && enclosure.getAttribute("type")?.startsWith("image/")) img = enclosure.getAttribute("url") || "";
                }
                if (img) {
                    img = img.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
                    img = img.replace(/['"]/g, '');
                    if (img.startsWith('http:')) img = 'https:' + img.substring(5);
                    if (img.startsWith('/')) {
                        try { img = new URL(rss.url).origin + img; } catch (e) {
                            const domainMatch = rss.url.match(/^(https?:\/\/[^\/]+)/);
                            if (domainMatch) img = domainMatch[1] + img;
                        }
                    }
                }
                const defaultLogo = rss.logo || "https://mmt8129.github.io/Gem/rsslogo.png";
                const description = el.querySelector("description")?.textContent || "";
                const cleanDesc = description.replace(/<[^>]*>?/gm, '').trim().substring(0, 150) + "...";
                if (title && title.length > 5) {
                    news.push({
                        id: 'n' + Date.now() + Math.random().toString(36).substr(2, 5),
                        title: title.trim(), link: link.trim(), source: rss.ad, category: rss.kategori || "GÜNDEM",
                        pubDate: date, date: date, thumbnail: img || defaultLogo, image: img || defaultLogo,
                        description: description, kicker: rss.ad, dek: cleanDesc
                    });
                }
            });
        } catch (e) { console.log('RSS fetch hatası:', rss.ad, e); }
    }
    news.sort(() => Math.random() - 0.5);
    localStorage.setItem('haberai_news_cache', JSON.stringify(news));
    renderAll();
}
db.ref('rss_ayarlari').once('value', snap => {
    rssListesi = snap.val() || {};
    if (Object.keys(rssListesi).length > 0) fetchAllNews(false);
    else document.getElementById('newsListMount').innerHTML = '<div class="empty-state">Henüz RSS kaynağı eklenmemiş. Ayarlardan ekleyebilirsiniz.</div>';
});

// ==================== RENDER ====================
function renderAll() {
    let filtered = [...news];
    if (currentCategory !== 'all') filtered = filtered.filter(n => n.category === currentCategory);
    if (selectedDateFilter) filtered = filtered.filter(n => n.date && dateKey(n.date) === selectedDateFilter);
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const carouselNews = getRecentNews(filtered);
    const carouselMount = document.getElementById('carouselMount');
    if (carouselNews.length === 0) {
        carouselMount.innerHTML = '<div class="empty-state">Bu kategoride haber bulunmuyor.</div>';
    } else {
        carouselMount.innerHTML = `
            <div class="carousel-section">
                ${carouselNews.map(n => `
                    <div class="carousel-card" onclick="openDetailPage('${n.id}')">
                        <img src="${n.thumbnail || n.image}" alt="${n.title}" onerror="this.style.background='#333';">
                        <div class="card-gradient"></div>
                        <div class="card-body">
                            <div class="card-kicker">${n.source}</div>
                            <h2 class="card-headline">${n.title}</h2>
                            <div class="card-meta">${timeAgo(n.date)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    }
    const listMount = document.getElementById('newsListMount');
    const displayedNews = filtered.slice(0, visibleCount);
    let listHTML = '<div class="section-flag"><span class="section-flag-text">Haberler</span><div class="section-flag-rule"></div></div>';
    if (displayedNews.length === 0) {
        listHTML += '<div class="empty-state">' + (selectedDateFilter ? 'Seçili tarihte haber bulunmuyor.' : 'Bu kategoride haber bulunmuyor.') + '</div>';
    } else {
        displayedNews.forEach((n) => {
            listHTML += `
                <article class="story-list-item" onclick="openDetailPage('${n.id}')">
                    <img class="list-item-thumb" src="${n.thumbnail || n.image}" alt="${n.title}" onerror="this.style.display='none';">
                    <div class="list-item-content">
                        <div class="list-item-kicker">${n.source}</div>
                        <div class="list-item-headline">${n.title}</div>
                        <div class="list-item-meta">${timeAgo(n.date)}</div>
                    </div>
                </article>`;
        });
    }
    if (filtered.length > visibleCount) {
        listHTML += `<div class="load-more-area"><button class="btn-load-more" onclick="loadMore()">Daha Fazla Göster (${filtered.length - visibleCount})</button></div>`;
    }
    listMount.innerHTML = listHTML;
    document.getElementById('scrollArea').scrollTop = 0;
}
function loadMore() { visibleCount += newsLimit; renderAll(); document.getElementById('scrollArea').scrollTo({ top: document.getElementById('scrollArea').scrollHeight, behavior: 'smooth' }); }
function setCategory(el, cat) { document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); el.classList.add('active'); currentCategory = cat; visibleCount = newsLimit; renderAll(); }
function softRefresh() { visibleCount = newsLimit; localStorage.removeItem('haberai_news_cache'); fetchAllNews(true); showToast('🔄 Haberler yenilendi'); }

// ==================== AI SOHBET ====================
function openAIModal(initialText) {
    document.getElementById('aiModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    const body = document.getElementById('aiChatBody');
    body.innerHTML = '<div class="msg ai">Sohbet geçmişi yükleniyor...</div>';
    
    db.ref('ai_sohbet_gecmisi').once('value', snap => {
        const data = snap.val();
        aiChatHistory = [];
        if (data) {
            const messages = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);
            messages.forEach(msg => aiChatHistory.push({ role: msg.sender === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] }));
        }
        renderAIChat();
    });

    if (initialText) setTimeout(() => { document.getElementById('aiInput').value = initialText; sendAIMessage(); }, 300);
    else setTimeout(() => document.getElementById('aiInput').focus(), 400);
    pushModal('ai');
}
function closeAIModal(useStack = true) {
    document.getElementById('aiModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}
function renderAIChat() {
    const body = document.getElementById('aiChatBody');
    body.innerHTML = '<div class="msg ai">Merhaba, sana nasıl yardımcı olabilirim?</div>';
    aiChatHistory.forEach((msg, index) => {
        const roleClass = msg.role === 'user' ? 'user' : 'ai';
        const text = msg.role === 'user' ? msg.parts[0].text : metniTemizle(msg.parts[0].text);
        if (msg.role === 'model' && index === aiChatHistory.length - 1) {
            body.innerHTML += `
                <div class="msg ai" style="max-width: 100%; width: 100%;">
                    ${text}
                    <div class="ai-tabs" id="inlineTabs">
                        <button class="ai-tab active" id="tab-ai" onclick="switchTab('ai')">ai</button>
                        <button class="ai-tab" id="tab-search" onclick="switchTab('search')">arama</button>
                        <button class="ai-tab" id="tab-image" onclick="switchTab('image')">görsel</button>
                    </div>
                    <div id="inlineTabContent">
                        <div class="search-body" id="inlineSearchBody" style="display: none;"></div>
                        <div class="image-body" id="inlineImageBody" style="display: none;"></div>
                    </div>
                </div>`;
        } else {
            body.innerHTML += `<div class="msg ${roleClass}">${text}</div>`;
        }
    });
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
}
async function sendAIMessage() {
    const inp = document.getElementById('aiInput');
    const text = inp.value.trim();
    if (!text) return;
    currentQuery = text;
    const body = document.getElementById('aiChatBody');
    body.innerHTML += `<div class="msg user">${text}</div>`;
    inp.value = '';
    aiChatHistory.push({ role: "user", parts: [{ text: text }] });
    db.ref('ai_sohbet_gecmisi').push({ sender: 'user', text: text, timestamp: Date.now() });
    const typingId = 'typing-' + Date.now();
    body.innerHTML += `<div class="msg ai" id="${typingId}"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    try {
        const cevap = await callGemini(text);
        aiChatHistory.push({ role: "model", parts: [{ text: cevap }] });
        db.ref('ai_sohbet_gecmisi').push({ sender: 'ai', text: cevap, timestamp: Date.now() });
        const typing = document.getElementById(typingId);
        if (typing) typing.remove();
        renderAIChat();
    } catch (e) {
        const typing = document.getElementById(typingId);
        if (typing) typing.remove();
        body.innerHTML += '<div class="msg ai">Bağlantı hatası! 😕</div>';
    }
}
async function generateSearchQuery(question) {
    try {
        const prompt = `Aşağıdaki kullanıcı sorusunu, Google aramasında en iyi sonucu verecek kısa ve net bir arama kelimesine/cümlesine dönüştür. Sadece arama kelimesini yaz, başka hiçbir şey yazma. Tırnak işareti kullanma.\n\nSoru: ${question}`;
        const cevap = await callGemini(prompt);
        return metniTemizle(cevap).replace(/<[^>]*>?/gm, '').trim() || question;
    } catch (e) { return question; }
}
async function switchTab(type) {
    document.getElementById('tab-ai').classList.remove('active');
    document.getElementById('tab-search').classList.remove('active');
    document.getElementById('tab-image').classList.remove('active');
    document.getElementById(`tab-${type}`).classList.add('active');
    const searchBody = document.getElementById('inlineSearchBody');
    const imageBody = document.getElementById('inlineImageBody');
    if (type === 'ai') { searchBody.style.display = 'none'; imageBody.style.display = 'none'; }
    else if (type === 'search') {
        searchBody.style.display = 'flex'; imageBody.style.display = 'none';
        searchBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Google araması için hazırlanıyor...</div>';
        const optimizedQuery = await generateSearchQuery(currentQuery);
        window.open(`https://www.google.com/search?q=${encodeURIComponent(optimizedQuery)}`, '_blank');
        searchBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Google yeni sekmede açıldı.</div>';
    } else if (type === 'image') {
        searchBody.style.display = 'none'; imageBody.style.display = 'grid';
        imageBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Google Görseller için hazırlanıyor...</div>';
        const optimizedQuery = await generateSearchQuery(currentQuery);
        window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(optimizedQuery)}`, '_blank');
        imageBody.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Google Görseller yeni sekmede açıldı.</div>';
    }
}
function confirmClearChat() {
    const container = document.getElementById('confirmModalContainer');
    container.innerHTML = `<div class="modal-header"><h2>Sohbeti Temizle</h2><button onclick="closeConfirmModal()">✕</button></div><div class="modal-body" style="text-align:center;"><p>Temizlemek istiyor musun?</p></div><div class="modal-footer"><button class="btn-full" onclick="closeConfirmModal()">VAZGEÇ</button><button class="btn-full danger" onclick="clearChatAndClose()">EVET, SİL</button></div>`;
    document.getElementById('confirmModalOverlay').classList.add('active');
    pushModal('confirm');
}
function closeConfirmModal(useStack = true) {
    document.getElementById('confirmModalOverlay').classList.remove('active');
    if (useStack) popModal();
}
function clearChatAndClose() {
    db.ref('ai_sohbet_gecmisi').remove();
    document.getElementById('aiChatBody').innerHTML = '<div class="msg ai">Merhaba, sana nasıl yardımcı olabilirim?</div>';
    closeConfirmModal();
    showToast('🗑️ Sohbet temizlendi');
}

// ==================== DİĞER FONKSİYONLAR ====================
function handleInput() {
    const inp = document.getElementById('mainInput');
    const val = inp.value.trim();
    if (!val) return;
    const searchMatch = val.match(/\*(.*?)\*/);
    if (searchMatch && searchMatch[1].trim()) openSearchModal(searchMatch[1].trim());
    else openAIModal(val);
    inp.value = '';
}
function openSearchModal(query) {
    const results = news.filter(n => n.title.toLowerCase().includes(query.toLowerCase()));
    const container = document.getElementById('searchModalContainer');
    container.innerHTML = `<div class="modal-header"><h2>🔍 Arama: "${query}"</h2><button onclick="closeSearchModal()">✕</button></div><div class="modal-body">${results.length === 0 ? '<div class="empty-state">Sonuç bulunamadı.</div>' : results.map(n => `<div class="story-list-item" onclick="openDetailPage('${n.id}');" style="box-shadow:none; border-bottom:1px solid var(--border); border-radius:0; padding:10px 0;"><img class="list-item-thumb" src="${n.thumbnail || n.image}" onerror="this.style.display='none';"><div class="list-item-content"><div class="list-item-headline" style="font-size:0.9rem;">${n.title}</div><div class="list-item-meta">${n.source} · ${timeAgo(n.date)}</div></div></div>`).join('')}</div>`;
    document.getElementById('searchModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModal('search', { query });
}
function closeSearchModal(useStack = true) {
    document.getElementById('searchModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

document.addEventListener('keydown', (e) => {
    if (e.key === '/') {
        const a = document.activeElement;
        if (a !== document.getElementById('mainInput') && a !== document.getElementById('aiInput')) { e.preventDefault(); document.getElementById('mainInput').focus(); }
    }
    if (e.key === 'Escape') { closeTopModal(); }
});

updateSavedBadge();

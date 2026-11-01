// ==================== KONFIGÜRASYON ====================
const GEMINI_PROXY_URL = "https://imdb-gemini.06mmt8129.workers.dev";

const fbCfg = {
    apiKey: "AIzaSyBr57bmspJo8r_4IdkBNI_DhULYf0ynCQs",
    databaseURL: "https://gen-lang-client-0253857481-default-rtdb.firebaseio.com",
    projectId: "gen-lang-client-0253857481"
};

if (!firebase.apps.length) firebase.initializeApp(fbCfg);
const db = firebase.database();

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

// 1. TEMA DEĞİŞTİRME FONKSİYONLARI (En üste ekle)
function initTheme() {
    const savedTheme = localStorage.getItem('haberai_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function setTheme(theme) {
    localStorage.setItem('haberai_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    // Ayarlar açıksa butonları güncelle
    const lightBtn = document.getElementById('themeLight');
    const darkBtn = document.getElementById('themeDark');
    if (lightBtn && darkBtn) {
        if (theme === 'light') { lightBtn.classList.add('active'); darkBtn.classList.remove('active'); }
        else { darkBtn.classList.add('active'); lightBtn.classList.remove('active'); }
    }
}

// 2. FONT BOYUTU DEĞİŞTİRME (AI Sheet için)
let detailFontSize = 16;
function changeFontSize(amount) {
    detailFontSize += amount;
    if (detailFontSize < 12) detailFontSize = 12;
    if (detailFontSize > 26) detailFontSize = 26;
    
    // Tüm mesajların boyutunu dinamik olarak ayarla
    const chatBody = document.getElementById('detailChatBody');
    if (chatBody) {
        chatBody.style.fontSize = detailFontSize + 'px';
    }
}

async function callGemini(text) {
    const res = await fetch(GEMINI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
    });
    if (!res.ok) {
        const err = await res.text();
        console.log('Gemini hata:', res.status, err);
        throw new Error('Gemini ' + res.status);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Cevap alınamadı.';
}

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
let modalStack = [];
let disabledSources = JSON.parse(localStorage.getItem('haberai_disabled_sources') || '[]');

let selectedDateFilter = null;
let tempSelectedDate = null;
let calendarViewDate = new Date();

let weatherDailyData = [];
let weatherCurrentData = null;

// Haber detay sayfası yazı boyutu kontrolü
let currentDetailSize = 16;

function changeDetailFontSize(amount) {
    currentDetailSize += amount;
    
    // Sınırları belirle (Çok küçük veya çok büyük olmasın)
    if (currentDetailSize < 12) currentDetailSize = 12;
    if (currentDetailSize > 26) currentDetailSize = 26;
    
    // Haber içeriğini ve başlığını seç
    const bodyText = document.querySelector('.article-body');
    const titleText = document.querySelector('.article-title');
    
    if (bodyText) bodyText.style.fontSize = currentDetailSize + 'px';
    
    // Başlık gövdeden biraz daha büyük kalsın
    if (titleText) titleText.style.fontSize = (currentDetailSize + 6) + 'px';
}

// ==================== TARİH ====================
function updateDate() {
    const el = document.getElementById('mastheadDate');
    if (selectedDateFilter) {
        const d = new Date(selectedDateFilter + 'T00:00:00');
        el.textContent = '📅 ' + d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
        el.classList.add('filtered');
    } else {
        el.textContent = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
        el.classList.remove('filtered');
    }
}

// ==================== YARDIMCILAR ====================
function timeAgo(ds) {
    if (!ds) return '';
    const diff = (new Date() - new Date(ds)) / 60000;
    if (diff < 1) return 'Az önce';
    if (diff < 60) return Math.floor(diff) + ' dk önce';
    if (diff < 1440) return Math.floor(diff / 60) + ' sa önce';
    return new Date(ds).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function getLast3Days(arr) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 5);
    return arr.filter(n => new Date(n.date) >= cutoff);
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
        if (cachedData) {
            news = JSON.parse(cachedData);
            renderAll();
            return;
        }
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

                if (!img) {
                    const contentEncoded = el.querySelector("content\\:encoded") || el.getElementsByTagNameNS("http://purl.org/rss/1.0/modules/content/", "encoded")[0];
                    if (contentEncoded?.textContent) {
                        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
                        const matches = [...contentEncoded.textContent.matchAll(imgRegex)];
                        for (const match of matches) {
                            if (!match[1].includes('icon') && !match[1].includes('logo') && !match[1].includes('avatar')) { img = match[1]; break; }
                        }
                        if (!img && matches.length > 0) img = matches[0][1];
                    }
                }

                if (!img) {
                    const description = el.querySelector("description");
                    if (description?.textContent) {
                        let descText = description.textContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
                        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
                        const matches = [...descText.matchAll(imgRegex)];
                        for (const match of matches) {
                            const imgUrl = match[1];
                            if (imgUrl && !imgUrl.includes('data:image') && !imgUrl.includes('icon')) { img = imgUrl; break; }
                        }
                        if (!img) {
                            const urlMatch = descText.match(/(https?:\/\/[^\s"']+\.(jpg|jpeg|png|gif|webp))/i);
                            if (urlMatch) img = urlMatch[1];
                        }
                    }
                }

                if (img) {
                    img = img.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
                    img = img.replace(/['"]/g, '');
                    if (img.startsWith('http:')) img = 'https:' + img.substring(5);
                    if (img.startsWith('/')) {
                        try {
                            const baseUrl = new URL(rss.url).origin;
                            img = baseUrl + img;
                        } catch (e) {
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
                        title: title.trim(),
                        link: link.trim(),
                        source: rss.ad,
                        category: rss.kategori || "GÜNDEM",
                        pubDate: date,
                        date: date,
                        thumbnail: img || defaultLogo,
                        image: img || defaultLogo,
                        description: description,
                        kicker: rss.ad,
                        dek: cleanDesc
                    });
                }
            });
        } catch (e) {
            console.log('RSS fetch hatası:', rss.ad, e);
        }
    }

    news.sort(() => Math.random() - 0.5);
    localStorage.setItem('haberai_news_cache', JSON.stringify(news));
    localStorage.setItem('haberai_news_time', new Date().getTime());
    renderAll();
}

db.ref('rss_ayarlari').once('value', snap => {
    rssListesi = snap.val() || {};
    if (Object.keys(rssListesi).length > 0) {
        fetchAllNews(false);
    } else {
        document.getElementById('newsListMount').innerHTML = '<div class="empty-state">Henüz RSS kaynağı eklenmemiş. Ayarlardan ekleyebilirsiniz.</div>';
    }
});

// ==================== RENDER ====================
function renderAll() {
    let filtered = [...news];
    if (currentCategory !== 'all') filtered = filtered.filter(n => n.category === currentCategory);
    if (selectedDateFilter) {
        filtered = filtered.filter(n => n.date && dateKey(n.date) === selectedDateFilter);
    }

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const carouselNews = getLast3Days(filtered);
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

function loadMore() {
    visibleCount += newsLimit;
    renderAll();
    document.getElementById('scrollArea').scrollTo({ top: document.getElementById('scrollArea').scrollHeight, behavior: 'smooth' });
}

function setCategory(el, cat) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    currentCategory = cat;
    visibleCount = newsLimit;
    renderAll();
}

function softRefresh() {
    visibleCount = newsLimit;
    localStorage.removeItem('haberai_news_cache');
    localStorage.removeItem('haberai_news_time');
    fetchAllNews(true);
    showToast('🔄 Haberler yenilendi');
}

// ==================== INPUT ====================
function handleInput() {
    const inp = document.getElementById('mainInput');
    const val = inp.value.trim();
    if (!val) return;
    const searchMatch = val.match(/\*(.*?)\*/);
    if (searchMatch && searchMatch[1].trim()) { openSearchModal(searchMatch[1].trim()); }
    else { openAIModal(val); }
    inp.value = '';
}

// ==================== AI MODAL (GEMINI) ====================
function openAIModal(initialText) {
    document.getElementById('aiModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    const body = document.getElementById('aiChatBody');
    
    body.innerHTML = '<div class="msg ai">Sohbet geçmişi yükleniyor...</div>';
    
    // Firebase'den geçmiş sohbetleri çek
    db.ref('ai_sohbet_gecmisi').once('value', snap => {
        body.innerHTML = '';
        const data = snap.val();
        if (data) {
            Object.values(data).forEach(msg => {
                body.innerHTML += `<div class="msg ${msg.sender}">${msg.text}</div>`;
            });
        }
        if (!body.innerHTML) {
            body.innerHTML = '<div class="msg ai">Merhaba, sana nasıl yardımcı olabilirim?</div>';
        }
        body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    });

    if (initialText) { 
        setTimeout(() => { document.getElementById('aiInput').value = initialText; sendAIMessage(); }, 300); 
    } else { 
        setTimeout(() => document.getElementById('aiInput').focus(), 400); 
    }
    pushModal('ai');
}

function closeAIModal(useStack = true) {
    document.getElementById('aiModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}

async function sendAIMessage() {
    const inp = document.getElementById('aiInput');
    const text = inp.value.trim();
    if (!text) return;
    const body = document.getElementById('aiChatBody');
    body.innerHTML += `<div class="msg user">${text}</div>`;
    inp.value = '';

    // Kullanıcı mesajını Firebase'e kaydet
    db.ref('ai_sohbet_gecmisi').push({ sender: 'user', text: text, timestamp: Date.now() });

    const typingId = 'typing-' + Date.now();
    body.innerHTML += `<div class="msg ai" id="${typingId}"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });

    try {
        const cevap = await callGemini(text);
        const temizCevap = metniTemizle(cevap);
        const typing = document.getElementById(typingId);
        if (typing) typing.remove();
        body.innerHTML += `<div class="msg ai">${temizCevap}</div>`;
        body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });

        // AI yanıtını Firebase'e kaydet
        db.ref('ai_sohbet_gecmisi').push({ sender: 'ai', text: temizCevap, timestamp: Date.now() });
    } catch (e) {
        console.log('AI gönderim hatası:', e);
        const typing = document.getElementById(typingId);
        if (typing) typing.remove();
        body.innerHTML += '<div class="msg ai">Bağlantı hatası! 😕</div>';
        body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    }
}

function confirmClearChat() {
    const container = document.getElementById('confirmModalContainer');
    container.innerHTML = `
        <div class="modal-header"><h2>Sohbeti Temizle</h2><button onclick="closeConfirmModal()">✕</button></div>
        <div class="modal-body" style="text-align:center;"><p>Ekrandaki sohbeti temizlemek istiyor musun?</p></div>
        <div class="modal-footer"><button class="btn-full" onclick="closeConfirmModal()">VAZGEÇ</button><button class="btn-full danger" onclick="clearChatAndClose()">EVET, SİL</button></div>`;
    document.getElementById('confirmModalOverlay').classList.add('active');
    pushModal('confirm');
}

function closeConfirmModal(useStack = true) {
    document.getElementById('confirmModalOverlay').classList.remove('active');
    if (useStack) popModal();
}

function clearChatAndClose() {
    // Firebase'den sohbet geçmişini tamamen sil
    db.ref('ai_sohbet_gecmisi').remove();
    
    document.getElementById('aiChatBody').innerHTML = '<div class="msg ai">Merhaba, sana nasıl yardımcı olabilirim?</div>';
    closeConfirmModal();
    showToast('🗑️ Sohbet temizlendi');
}

// ==================== SEARCH MODAL ====================
function openSearchModal(query) {
    const results = news.filter(n => n.title.toLowerCase().includes(query.toLowerCase()));
    const container = document.getElementById('searchModalContainer');
    container.innerHTML = `
        <div class="modal-header"><h2>🔍 Arama: "${query}"</h2><button onclick="closeSearchModal()">✕</button></div>
        <div class="modal-body">${results.length === 0 ? '<div class="empty-state">Sonuç bulunamadı.</div>' : results.map(n => `
            <div class="story-list-item" onclick="openDetailPage('${n.id}');" style="box-shadow:none; border-bottom:1px solid var(--border); border-radius:0; padding:10px 0;">
                <img class="list-item-thumb" src="${n.thumbnail || n.image}" onerror="this.style.display='none';">
                <div class="list-item-content"><div class="list-item-headline" style="font-size:0.9rem;">${n.title}</div><div class="list-item-meta">${n.source} · ${timeAgo(n.date)}</div></div>
            </div>
        `).join('')}</div>`;
    document.getElementById('searchModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModal('search', { query });
}

function closeSearchModal(useStack = true) {
    document.getElementById('searchModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}

// ==================== SETTINGS ====================
// 3. AYARLAR MODALINI GÜNCELLE (Tema seçimi ekle)
function openSettingsModal() {
    const container = document.getElementById('settingsModalContainer');
    const currentTheme = localStorage.getItem('haberai_theme') || 'light';
    container.innerHTML = `
        <div class="modal-header"><h2>⚙️ Ayarlar</h2><button onclick="closeSettingsModal()">✕</button></div>
        <div class="modal-body">
            <div style="margin-bottom:20px;">
                <label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:10px;">Tema Seçimi</label>
                <div class="theme-toggle">
                    <button class="theme-btn ${currentTheme === 'light' ? 'active' : ''}" id="themeLight" onclick="setTheme('light')">☀️ Aydınlık</button>
                    <button class="theme-btn ${currentTheme === 'dark' ? 'active' : ''}" id="themeDark" onclick="setTheme('dark')">🌙 Karanlık</button>
                </div>
            </div>
            
            <div style="margin-bottom:20px;">
                <label style="font-weight:600;font-size:0.9rem;display:block;margin-bottom:10px;">Haber Sayısı</label>
                <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg);padding:10px;border-radius:12px;">
                    <button onclick="adjustNewsLimit(-5)" style="width:40px;height:40px;border-radius:10px;border:none;background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,0.1);">-</button>
                    <span id="newsLimitDisplay" style="font-weight:bold;font-size:1.2rem;">${newsLimit}</span>
                    <button onclick="adjustNewsLimit(5)" style="width:40px;height:40px;border-radius:10px;border:none;background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,0.1);">+</button>
                </div>
            </div>
            <button class="btn-full" onclick="openRSSModal()">📡 Kaynakları Yönet</button>
        </div>
        <div class="modal-footer"><button class="btn-full primary" onclick="closeSettingsModal()">Kapat</button></div>`;
    document.getElementById('settingsModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModal('settings');
}

function closeSettingsModal(useStack = true) {
    document.getElementById('settingsModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
    visibleCount = newsLimit;
    renderAll();
}

function adjustNewsLimit(amount) {
    let newLimit = newsLimit + amount;
    if (newLimit >= 5 && newLimit <= 20) {
        newsLimit = newLimit;
        localStorage.setItem('haberai_news_limit', newsLimit);
        document.getElementById('newsLimitDisplay').textContent = newsLimit;
    }
}

// ==================== RSS YÖNETİM ====================
function openRSSModal() {
    const container = document.getElementById('rssModalContainer');
    container.innerHTML = `
        <div class="modal-header"><div style="display:flex;align-items:center;gap:10px;"><button onclick="backToSettingsFromRSS()" style="background:var(--bg);">←</button><h2>Kaynaklar</h2></div><button onclick="openAddRSS()" style="background:var(--primary);color:#fff;width:auto;padding:0 15px;font-size:0.8rem;">Ekle</button></div>
        <div class="modal-body" id="rssListBody">Yükleniyor...</div>
        <div class="modal-footer"><button class="btn-full" onclick="backToSettingsFromRSS()">Geri Dön</button></div>`;
    document.getElementById('rssModalOverlay').classList.add('active');
    if (modalStack[modalStack.length - 1]?.type !== 'rss') pushModal('rss');
    
    db.ref('rss_ayarlari').once('value', snap => {
        const body = document.getElementById('rssListBody');
        if (!body) return;
        const data = snap.val();
        if (!data) { body.innerHTML = '<p style="text-align:center;">Kaynak yok.</p>'; return; }
        body.innerHTML = Object.keys(data).map(key => {
            const r = data[key];
            const isDisabled = disabledSources.includes(key);
            return `<div class="rss-item">
                <div class="rss-item-info"><strong>${r.ad}</strong><span>${r.kategori}</span></div>
                <div class="rss-item-actions">
                    <button onclick="toggleRSS('${key}')" id="rss-toggle-${key}" style="color:${isDisabled ? '#ccc' : '#22c55e'}">${isDisabled ? '🔴' : '🟢'}</button>
                    <button onclick="editRSS('${key}')">✏️</button>
                    <button onclick="confirmDeleteRSS('${key}')">🗑️</button>
                </div></div>`;
        }).join('');
    });
}

function closeRSSModal(useStack = true) {
    document.getElementById('rssModalOverlay').classList.remove('active');
    if (useStack) popModal();
}

function backToSettingsFromRSS() { 
    if (modalStack[modalStack.length - 1]?.type === 'rss') popModal();
    closeRSSModal(false); openSettingsModal(); 
}

function openAddRSS() {
    const container = document.getElementById('rssModalContainer');
    container.innerHTML = `
        <div class="modal-header"><div style="display:flex;align-items:center;gap:8px;"><button onclick="openRSSModal()" style="background:var(--bg);">←</button><h2>YENİ RSS EKLE</h2></div></div>
        <div class="modal-body">
            <label style="font-size:0.8rem;font-weight:600;">RSS ADI</label><input class="form-input" id="rssName" placeholder="Örn: TRT Haber">
            <label style="font-size:0.8rem;font-weight:600;">RSS URL</label><input class="form-input" id="rssUrl" placeholder="https://...">
            <label style="font-size:0.8rem;font-weight:600;">LOGO URL (İsteğe bağlı)</label><input class="form-input" id="rssLogo" placeholder="https://...">
            <label style="font-size:0.8rem;font-weight:600;">KATEGORİ</label><select class="form-select" id="rssCat">${['TÜRKİYE','DÜNYA','GÜNDEM','TEKNOLOJİ','SPOR','OTOMOBİL','DİĞER'].map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        </div>
        <div class="modal-footer"><button class="btn-full" onclick="openRSSModal()">İPTAL</button><button class="btn-full primary" onclick="saveRSS()">KAYDET</button></div>`;
    pushModal('rss');
}

function saveRSS() {
    const ad = document.getElementById('rssName')?.value;
    const url = document.getElementById('rssUrl')?.value;
    const kat = document.getElementById('rssCat')?.value;
    const logo = document.getElementById('rssLogo')?.value || '';
    if (!ad || !url) { showToast('Lütfen ad ve URL girin'); return; }
    db.ref('rss_ayarlari').push({ ad, url, kategori: kat, logo }).then(() => { showToast('✅ RSS eklendi'); openRSSModal(); }).catch(e => showToast('Hata: ' + e.message));
}

function editRSS(key) {
    db.ref('rss_ayarlari/' + key).once('value', snap => {
        const r = snap.val(); if (!r) return;
        const container = document.getElementById('rssModalContainer');
        container.innerHTML = `
        <div class="modal-header"><div style="display:flex;align-items:center;gap:8px;"><button onclick="openRSSModal()" style="background:var(--bg);">←</button><h2>RSS DÜZENLE</h2></div></div>
        <div class="modal-body">
            <label style="font-size:0.8rem;font-weight:600;">RSS ADI</label><input class="form-input" id="editRssName" value="${r.ad}">
            <label style="font-size:0.8rem;font-weight:600;">RSS URL</label><input class="form-input" id="editRssUrl" value="${r.url}">
            <label style="font-size:0.8rem;font-weight:600;">LOGO URL</label><input class="form-input" id="editRssLogo" value="${r.logo || ''}">
            <label style="font-size:0.8rem;font-weight:600;">KATEGORİ</label><select class="form-select" id="editRssCat">${['TÜRKİYE','DÜNYA','GÜNDEM','TEKNOLOJİ','SPOR','OTOMOBİL','DİĞER'].map(c => `<option value="${c}" ${r.kategori===c?'selected':''}>${c}</option>`).join('')}</select>
        </div>
        <div class="modal-footer"><button class="btn-full" onclick="openRSSModal()">İPTAL</button><button class="btn-full primary" onclick="updateRSS('${key}')">GÜNCELLE</button></div>`;
        pushModal('rss');
    });
}

function updateRSS(key) {
    const ad = document.getElementById('editRssName')?.value;
    const url = document.getElementById('editRssUrl')?.value;
    const kat = document.getElementById('editRssCat')?.value;
    const logo = document.getElementById('editRssLogo')?.value || '';
    if (!ad || !url) { showToast('Lütfen ad ve URL girin'); return; }
    db.ref('rss_ayarlari/' + key).update({ ad, url, kategori: kat, logo }).then(() => { showToast('✅ Güncellendi'); openRSSModal(); }).catch(e => showToast('Hata: ' + e.message));
}

function confirmDeleteRSS(key) {
    const container = document.getElementById('rssModalContainer');
    container.innerHTML = `
        <div class="modal-header"><h2 style="color:var(--primary);">Sil?</h2><button onclick="openRSSModal()">✕</button></div>
        <div class="modal-body" style="text-align:center;"><p>Bu kaynağı silmek istiyor musun?</p></div>
        <div class="modal-footer"><button class="btn-full danger" onclick="executeDeleteRSS('${key}')">Evet, Sil</button></div>`;
    pushModal('rss');
}

function executeDeleteRSS(key) {
    db.ref('rss_ayarlari/' + key).remove().then(() => { showToast('🗑️ Silindi'); openRSSModal(); });
}

function toggleRSS(key) {
    if (disabledSources.includes(key)) { disabledSources = disabledSources.filter(id => id !== key); } 
    else { disabledSources.push(key); }
    localStorage.setItem('haberai_disabled_sources', JSON.stringify(disabledSources));
    const btn = document.getElementById('rss-toggle-' + key);
    if (btn) {
        const isDisabled = disabledSources.includes(key);
        btn.style.color = isDisabled ? '#ccc' : '#22c55e';
        btn.textContent = isDisabled ? '🔴' : '🟢';
    }
    showToast(disabledSources.includes(key) ? '🔴 Pasif' : '🟢 Aktif');
}

// ==================== KAYDEDİLENLER ====================
function openSavedModal() {
    const container = document.getElementById('savedModalContainer');
    let html = '<div class="modal-header"><h2>Kaydedilenler</h2><button onclick="closeSavedModal()">✕</button></div><div class="modal-body">';
    if (savedNews.length === 0) { html += '<div class="empty-state">Kayıt yok.</div>'; }
    else {
        savedNews.forEach((n, i) => {
            html += `<div class="story-list-item" onclick="openDetailPageFromSaved(${i})" style="border-bottom:1px solid var(--border); border-radius:0; padding:10px 0; box-shadow:none;">
                <div class="list-item-content"><div class="list-item-kicker">${n.source}</div><div class="list-item-headline" style="font-size:0.9rem;">${n.title}</div></div>
            </div>`;
        });
    }
  
  // ==================== KAYDEDİLENLER (DEVAM) ====================
    html += '</div><div class="modal-footer"><button class="btn-full" onclick="closeSavedModal()">Kapat</button></div>';
    container.innerHTML = html;
    document.getElementById('savedModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModal('saved');
}

function closeSavedModal(useStack = true) {
    document.getElementById('savedModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}

function deleteSaved(i) {
    savedNews.splice(i, 1);
    localStorage.setItem('haberai_saved', JSON.stringify(savedNews));
    updateSavedBadge();
    openSavedModal();
    showToast('🗑️ Silindi');
}

function openDetailPageFromSaved(i) {
    currentDetailNews = savedNews[i];
    showDetailPage();
}

// ==================== DETAY SAYFASI ====================
function openDetailPage(id) {
    currentDetailNews = news.find(n => n.id == id);
    if (!currentDetailNews) return;
    showDetailPage();
}

function showDetailPage() {
    const n = currentDetailNews;
    if (!n) return;
    document.getElementById('mainPage').style.display = 'none';
    const dp = document.getElementById('detailPage');
    dp.style.display = 'flex';
    dp.scrollTop = 0;
    document.getElementById('detailSource').textContent = n.source;
    document.getElementById('detailSource2').textContent = n.source;
    document.getElementById('detailImage').src = n.thumbnail || n.image || '';
    document.getElementById('detailImage').style.display = 'block';
    document.getElementById('detailCategory').textContent = (n.category || '').toUpperCase();
    document.getElementById('detailTitle').textContent = n.title;
    document.getElementById('detailDate').textContent = n.pubDate ? new Date(n.pubDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    document.getElementById('detailBody').innerHTML = '<p style="text-align:center; color:#888;">İçerik yükleniyor...</p>';

    if (n.link && n.link !== '#') {
        const proxyUrl = "https://wild-sky-08d7.06mmt8129.workers.dev/?url=";
        fetch(proxyUrl + encodeURIComponent(n.link))
            .then(res => res.text())
            .then(html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const paragraphs = Array.from(doc.querySelectorAll('p'))
                    .map(p => p.textContent.trim())
                    .filter(t => t.length > 40)
                    .slice(0, 5)
                    .join('<br><br>');
                if (paragraphs) {
                    const contentHTML = paragraphs.split('<br><br>').map(p => `<p>${p}</p>`).join('');
                    const endMarker = `
                        <div style="display:flex;align-items:center;gap:10px;margin-top:30px;padding:20px 0;">
                            <div style="flex:1;height:1px;background:#333;"></div>
                            <span style="font-size:0.7rem; color:#666; letter-spacing:0.1em;">BİTTİ</span>
                            <div style="flex:1;height:1px;background:#333;"></div>
                        </div>`;
                    document.getElementById('detailBody').innerHTML = contentHTML + endMarker;
                }
            })
            .catch(e => { console.log('İçerik çekme hatası:', e); });
    }

    detailStarred = savedNews.some(s => s.title === n.title);
    updateDetailStarBtn();
    document.getElementById('detailFab').style.display = 'flex';
    pushModal('detail');
}

function closeDetail(useStack = true) {
    document.getElementById('detailPage').style.display = 'none';
    document.getElementById('mainPage').style.display = '';
    document.body.style.overflow = '';
    currentDetailNews = null;
    if (useStack) popModal();
}

function toggleDetailStar() {
    if (!currentDetailNews) return;
    if (detailStarred) { savedNews = savedNews.filter(s => s.title !== currentDetailNews.title); }
    else { savedNews.push({ ...currentDetailNews, savedAt: new Date().toISOString() }); }
    detailStarred = !detailStarred;
    localStorage.setItem('haberai_saved', JSON.stringify(savedNews));
    updateSavedBadge();
    updateDetailStarBtn();
    showToast(detailStarred ? '★ Kaydedildi' : '☆ Kayıt kaldırıldı');
}

function updateDetailStarBtn() {
    const btn = document.getElementById('detailStarBtn');
    btn.textContent = detailStarred ? '★' : '☆';
    if (detailStarred) {
        btn.classList.add('saved');
    } else {
        btn.classList.remove('saved');
    }
}

function toggleDetailDropdown() {
    dropdownOpen = !dropdownOpen;
    document.getElementById('detailDropdown').classList.toggle('show', dropdownOpen);
}

function shareDetailNews() {
    dropdownOpen = false;
    document.getElementById('detailDropdown').classList.remove('show');
    if (navigator.share && currentDetailNews) {
        navigator.share({ title: currentDetailNews.title, url: currentDetailNews.link || '#' }).catch(() => {});
    }
}

function openDetailLink() {
    dropdownOpen = false;
    document.getElementById('detailDropdown').classList.remove('show');
    if (currentDetailNews && currentDetailNews.link && currentDetailNews.link !== '#') window.open(currentDetailNews.link, '_blank');
}

document.addEventListener('click', function(e) {
    const menu = document.getElementById('detailDropdown');
    const btn = document.getElementById('detailMenuBtn');
    if (dropdownOpen && menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
        dropdownOpen = false; menu.classList.remove('show');
    }
});

// ==================== DETAY AI SHEET ====================
function openDetailSheet() {
    document.getElementById('detailSheet').classList.add('active');
    document.getElementById('detailFab').style.display = 'none';
    document.body.style.overflow = 'hidden';

    const chatBody = document.getElementById('detailChatBody');
    // SADECE İÇERİĞİ SIFIRLA, HEADER'A DOKUNMA
    chatBody.innerHTML = '<div class="msg ai">Bu haber hakkında ne öğrenmek istersin?<div class="chip-row"><button class="chip" onclick="askDetailAI(\'Bu haberi kısa ve açıklayıcı şekilde maddeler halinde özetle.\')">✨ Özetle</button></div></div>';

    setTimeout(() => document.getElementById('detailChatInput').focus(), 400);
    pushModal('detailSheet');
}

function closeDetailSheet(useStack = true) {
    document.getElementById('detailSheet').classList.remove('active');
    document.getElementById('detailFab').style.display = 'flex';
    document.body.style.overflow = '';
    if (useStack) popModal();
}

async function sendDetailMessage() {
    const inp = document.getElementById('detailChatInput');
    const text = inp.value.trim();
    if (!text || !currentDetailNews) return;
    const body = document.getElementById('detailChatBody');
    body.innerHTML += `<div class="msg user">${text}</div>`;
    inp.value = '';
    const typingId = 'dtyping-' + Date.now();
    body.innerHTML += `<div class="msg ai" id="${typingId}"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });

    const contextPrompt = `Haber Başlığı: ${currentDetailNews.title}\nHaber Linki: ${currentDetailNews.link || ''}\nHaber Açıklaması: ${(currentDetailNews.description || '').replace(/<[^>]*>/g, '').substring(0, 800)}\n\nKullanıcı Sorusu: ${text}`;

    try {
        const cevap = await callGemini(contextPrompt);
        const temizCevap = metniTemizle(cevap);
        const typing = document.getElementById(typingId);
        if (typing) typing.remove();
        body.innerHTML += `<div class="msg ai">${temizCevap}</div>`;
        body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    } catch (e) {
        const typing = document.getElementById(typingId);
        if (typing) typing.remove();
        body.innerHTML += '<div class="msg ai">Bağlantı hatası! 😕</div>';
        body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    }
}

function askDetailAI(prompt) {
    document.getElementById('detailChatInput').value = prompt;
    sendDetailMessage();
}

// ==================== HAVA DURUMU ====================
function getWeatherIcon(code) {
    if (code === 0 || code === 1) return '☀️';
    if (code === 2 || code === 3) return '⛅';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 55) return '🌦️';
    if (code >= 61 && code <= 65) return '🌧️';
    if (code >= 71 && code <= 75) return '❄️';
    if (code >= 80 && code <= 82) return '⛈️';
    if (code >= 95) return '🌩️';
    return '🌈';
}

function getWeatherText(code) {
    const map = { 0: 'Açık', 1: 'Az Bulutlu', 2: 'Parçalı Bulutlu', 3: 'Kapalı', 45: 'Sisli', 48: 'Buzlu Sis', 51: 'Hafif Çise', 53: 'Çiseleme', 55: 'Yoğun Çise', 61: 'Hafif Yağmur', 63: 'Yağmur', 65: 'Yoğun Yağmur', 71: 'Hafif Kar', 73: 'Kar', 75: 'Yoğun Kar', 80: 'Hafif Sağanak', 81: 'Sağanak', 82: 'Yoğun Sağanak', 95: 'Gök Gürültülü', 96: 'Dolu', 99: 'Yoğun Dolu' };
    return map[code] || 'Bilinmiyor';
}

async function fetchWeather(city = 'Ankara') {
    try {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=tr`);
        const geoData = await geoRes.json();
        if (!geoData.results || geoData.results.length === 0) { showToast('Şehir bulunamadı!'); return; }
        const lat = geoData.results[0].latitude;
        const lon = geoData.results[0].longitude;
        const sehirAdi = geoData.results[0].name;

        const havaRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`);
        const data = await havaRes.json();

        weatherDailyData = data.daily.time.map((date, i) => ({
            date: date, max: data.daily.temperature_2m_max[i], min: data.daily.temperature_2m_min[i], code: data.daily.weathercode[i], icon: getWeatherIcon(data.daily.weathercode[i]), text: getWeatherText(data.daily.weathercode[i])
        }));
        
        weatherCurrentData = {
            temp: Math.round(data.current_weather.temperature), code: data.current_weather.weathercode, icon: getWeatherIcon(data.current_weather.weathercode), text: getWeatherText(data.current_weather.weathercode), city: sehirAdi
        };

        document.getElementById('weatherIcon').textContent = weatherCurrentData.icon;
        document.getElementById('weatherTemp').textContent = weatherCurrentData.temp + '°';

        localStorage.setItem('haberai_weather', JSON.stringify({ daily: weatherDailyData, current: weatherCurrentData, time: Date.now() }));
        if (document.getElementById('weatherModalOverlay').classList.contains('active')) renderWeatherModal(sehirAdi);
    } catch (e) { console.log('Hava durumu hatası:', e); }
}

function loadWeatherFromCache() {
    const cached = localStorage.getItem('haberai_weather');
    if (!cached) return false;
    try {
        const data = JSON.parse(cached);
        weatherDailyData = data.daily || [];
        weatherCurrentData = data.current || null;
        if (weatherCurrentData) {
            document.getElementById('weatherIcon').textContent = weatherCurrentData.icon;
            document.getElementById('weatherTemp').textContent = weatherCurrentData.temp + '°';
        }
        return true;
    } catch (e) { return false; }
}

function renderWeatherModal(cityName) {
    const container = document.getElementById('weatherModalContainer');
    const current = weatherCurrentData || {};
    container.innerHTML = `
        <div class="modal-header"><h2>Hava Durumu</h2><button onclick="closeWeatherModal()">✕</button></div>
        <div class="modal-body">
            <div class="weather-search-box">
                <input type="text" id="weatherSearchInput" placeholder="Şehir ara..." value="${cityName || 'Ankara'}">
                <button onclick="searchWeather()">Ara</button>
            </div>
            <div class="weather-current">
                <div class="wc-icon">${current.icon || '☀️'}</div>
                <div class="wc-temp">${current.temp != null ? current.temp + '°' : '--°'}</div>
                <div class="wc-text">${current.text || ''} · ${current.city || cityName || ''}</div>
            </div>
            <div style="font-weight:600;margin-bottom:10px;">7 Günlük Tahmin</div>
            <div class="weather-forecast-grid" id="weatherForecastGrid"></div>
        </div>`;

    const grid = document.getElementById('weatherForecastGrid');
    weatherDailyData.forEach(day => {
        const date = new Date(day.date + 'T00:00:00');
        const dayName = date.toLocaleDateString('tr-TR', { weekday: 'short' });
        const card = document.createElement('div');
        card.className = 'weather-day-card';
        card.innerHTML = `<div class="day-name">${dayName}</div><div class="day-icon">${day.icon}</div><div class="max">${Math.round(day.max)}°</div><div class="min">${Math.round(day.min)}°</div>`;
        grid.appendChild(card);
    });

    const inp = document.getElementById('weatherSearchInput');
    if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') searchWeather(); });
}

function openWeatherModal() {
    document.getElementById('weatherModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModal('weather');
    if (weatherDailyData.length > 0 && weatherCurrentData) renderWeatherModal(weatherCurrentData.city || 'Ankara');
    else { renderWeatherModal('Ankara'); fetchWeather('Ankara'); }
}

function closeWeatherModal(useStack = true) {
    document.getElementById('weatherModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}

function searchWeather() {
    const city = document.getElementById('weatherSearchInput')?.value.trim();
    if (!city) return;
    fetchWeather(city);
}

// ==================== TAKVİM ====================
function openCalendarModal() {
    tempSelectedDate = selectedDateFilter;
    calendarViewDate = new Date();
    if (tempSelectedDate) {
        const d = new Date(tempSelectedDate + 'T00:00:00');
        calendarViewDate = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    renderCalendarModal();
    document.getElementById('calendarModalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    pushModal('calendar');
}

function closeCalendarModal(useStack = true) {
    document.getElementById('calendarModalOverlay').classList.remove('active');
    document.body.style.overflow = '';
    if (useStack) popModal();
}

function renderCalendarModal() {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

    const todayKey = dateKey(new Date());
    const container = document.getElementById('calendarModalContainer');
    container.innerHTML = `
        <div class="modal-header"><h2>Takvim</h2><button onclick="closeCalendarModal()">✕</button></div>
        <div class="modal-body">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <button onclick="changeCalendarMonth(-1)" style="border:none;background:var(--bg);width:30px;height:30px;border-radius:50%;">◀</button>
                <span style="font-weight:700;">${monthNames[month]} ${year}</span>
                <button onclick="changeCalendarMonth(1)" style="border:none;background:var(--bg);width:30px;height:30px;border-radius:50%;">▶</button>
            </div>
            <div class="calendar-grid" id="calendarGrid"></div>
        </div>
        <div class="modal-footer">
            <button class="btn-full" onclick="closeCalendarModal()">İptal</button>
            <button class="btn-full primary" onclick="applyCalendarFilter()">Tamam</button>
        </div>`;

    const grid = document.getElementById('calendarGrid');
    ['P', 'S', 'Ç', 'P', 'C', 'C', 'P'].forEach(label => {
        const div = document.createElement('div'); div.className = 'day-label'; div.textContent = label; grid.appendChild(div);
    });

    let startOffset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = startOffset - 1; i >= 0; i--) {
        const div = document.createElement('div'); div.className = 'day-cell other-month'; div.textContent = daysInPrevMonth - i; grid.appendChild(div);
    }

    for (let i = 1; i <= daysInMonth; i++) {
        const div = document.createElement('div'); div.className = 'day-cell';
        const cellKey = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(i).padStart(2, '0');
        if (cellKey === todayKey) div.classList.add('today');
        if (cellKey === tempSelectedDate) div.classList.add('selected');
        div.textContent = i;
        div.onclick = () => selectCalendarDay(cellKey);
        grid.appendChild(div);
    }

    const totalCells = startOffset + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
        const div = document.createElement('div'); div.className = 'day-cell other-month'; div.textContent = i; grid.appendChild(div);
    }
}

function changeCalendarMonth(delta) {
    calendarViewDate.setMonth(calendarViewDate.getMonth() + delta);
    renderCalendarModal();
}

function selectCalendarDay(cellKey) {
    tempSelectedDate = cellKey;
    renderCalendarModal();
}

function applyCalendarFilter() {
    if (tempSelectedDate === dateKey(new Date())) { selectedDateFilter = null; }
    else if (tempSelectedDate) { selectedDateFilter = tempSelectedDate; }
    else { selectedDateFilter = null; }
    updateDate();
    visibleCount = newsLimit;
    renderAll();
    closeCalendarModal();
}

// ==================== TOAST & KEYBOARD ====================
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
        if (a !== document.getElementById('mainInput') && a !== document.getElementById('aiInput') && a !== document.getElementById('detailChatInput')) {
            e.preventDefault();
            document.getElementById('mainInput').focus();
        }
    }
    if (e.key === 'Escape') { closeTopModal(); }
});

// ==================== INIT ====================
updateSavedBadge();
updateDate();
loadWeatherFromCache();
fetchWeather('Ankara');
setInterval(() => fetchWeather(weatherCurrentData?.city || 'Ankara'), 30 * 60 * 1000);
setInterval(updateDate, 60 * 1000);



// 4. SCRIPT'İN EN ALTINA INIT EKLE (Tema yüklemesi için)
initTheme();


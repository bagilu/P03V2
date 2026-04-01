(function () {
  const { createClient } = window.supabase;
  const FEATURED_TABLE = 'TblP03FeaturedPairs';
  const STORAGE_KEY = 'p03_featured_liked_ids';

  const message = document.getElementById('featuredMessage');
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    message.textContent = '尚未設定 config.js，請先填入 Supabase URL 與 anon key。';
    return;
  }

  const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const results = document.getElementById('featuredResults');
  const stats = document.getElementById('featuredStats');
  const loading = document.getElementById('featuredLoading');
  const template = document.getElementById('featuredItemTemplate');

  function showLoading(show, text = '載入中…') {
    loading.textContent = text;
    loading.classList.toggle('hidden', !show);
  }

  function getLikedIds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.map(Number) : []);
    } catch {
      return new Set();
    }
  }

  function saveLikedIds(set) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
  }

  async function likeRow(row, btn, likesEl, likedIds) {
    if (likedIds.has(Number(row.id))) return;

    btn.disabled = true;
    message.textContent = '';

    const newLikes = (Number(row.likes_count) || 0) + 1;
    const { error } = await supabase
      .from(FEATURED_TABLE)
      .update({ likes_count: newLikes })
      .eq('id', row.id);

    if (error) {
      btn.disabled = false;
      message.textContent = `按讚失敗（id=${row.id}）：${error.message || error}`;
      return;
    }

    row.likes_count = newLikes;
    likesEl.textContent = `按讚數 ${row.likes_count}｜建立時間 ${new Date(row.created_at).toLocaleString('zh-TW')}`;
    likedIds.add(Number(row.id));
    saveLikedIds(likedIds);
    btn.textContent = '已讚';
  }

  function renderRows(rows) {
    const likedIds = getLikedIds();
    const fragment = document.createDocumentFragment();

    rows.forEach((row) => {
      const node = template.content.cloneNode(true);
      const item = node.querySelector('.result-item');
      const termEl = node.querySelector('.term');
      const metaEl = node.querySelector('.meta');
      const likeBtn = node.querySelector('.like-btn');

      item.dataset.id = row.id;
      termEl.textContent = `${row.source_term}，${row.selected_term}`;
      metaEl.textContent = `按讚數 ${row.likes_count}｜建立時間 ${new Date(row.created_at).toLocaleString('zh-TW')}`;

      if (likedIds.has(Number(row.id))) {
        likeBtn.disabled = true;
        likeBtn.textContent = '已讚';
      }

      likeBtn.addEventListener('click', () => likeRow(row, likeBtn, metaEl, likedIds));
      fragment.appendChild(node);
    });

    results.innerHTML = '';
    results.appendChild(fragment);
  }

  async function loadFeatured() {
    showLoading(true, '載入精選中…');
    message.textContent = '';

    try {
      const { data, error } = await supabase
        .from(FEATURED_TABLE)
        .select('id, source_term, selected_term, created_at, likes_count')
        .order('likes_count', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5000);

      if (error) throw error;

      const rows = data || [];
      stats.textContent = `目前共 ${rows.length} 筆精選`;

      if (!rows.length) {
        results.innerHTML = '';
        message.textContent = '目前尚無精選資料。';
        return;
      }

      renderRows(rows);
    } catch (err) {
      console.error(err);
      message.textContent = `讀取精選失敗：${err.message || err}`;
    } finally {
      showLoading(false);
    }
  }

  loadFeatured();
})();

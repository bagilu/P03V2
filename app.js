(function () {
  const { createClient } = window.supabase;

  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    document.getElementById('message').textContent = '尚未設定 config.js，請先填入 Supabase URL 與 anon key。';
    return;
  }

  const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const PAGE_SIZE = 50;
  const TABLE_NAME = 'TblP03LexiconRhyme';

  const searchForm = document.getElementById('searchForm');
  const termInput = document.getElementById('termInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchInfo = document.getElementById('searchInfo');
  const message = document.getElementById('message');
  const stats = document.getElementById('stats');
  const results = document.getElementById('results');
  const loading = document.getElementById('loading');
  const endMessage = document.getElementById('endMessage');
  const sentinel = document.getElementById('sentinel');
  const template = document.getElementById('resultItemTemplate');

  let currentFinalVowel = null;
  let currentLastChar = null;
  let currentOffset = 0;
  let finished = false;
  let loadingNow = false;
  let totalCount = null;
  let observer = null;
  let searchToken = 0;

  function resetUI() {
    searchInfo.textContent = '';
    message.textContent = '';
    stats.textContent = '';
    results.innerHTML = '';
    endMessage.classList.add('hidden');
    loading.classList.add('hidden');
    finished = false;
    loadingNow = false;
    currentOffset = 0;
    totalCount = null;
  }

  function showLoading(show) {
    loading.classList.toggle('hidden', !show);
  }

  function normalizeInput(value) {
    return value.trim();
  }

  function getLastCharacter(text) {
    const chars = Array.from(text);
    return chars.length ? chars[chars.length - 1] : '';
  }

  async function lookupLastCharacterFinalVowel(lastChar) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('final_vowel', { count: 'exact' })
      .eq('term', lastChar)
      .limit(1);

    if (error) throw error;
    return data && data.length ? data[0].final_vowel : null;
  }

  async function fetchSameFinalVowelPage(token) {
    if (finished || loadingNow || !currentFinalVowel) return;
    loadingNow = true;
    showLoading(true);

    try {
      const from = currentOffset;
      const to = currentOffset + PAGE_SIZE - 1;

      const { data, count, error } = await supabase
        .from(TABLE_NAME)
        .select('id, term, final_vowel', { count: 'exact' })
        .eq('final_vowel', currentFinalVowel)
        .order('id', { ascending: true })
        .range(from, to);

      if (token !== searchToken) return;
      if (error) throw error;

      if (typeof count === 'number') totalCount = count;

      appendResults(data || []);
      currentOffset += (data || []).length;

      stats.textContent = `最後字：${currentLastChar}　韻母：${currentFinalVowel}　目前顯示：${currentOffset}${typeof totalCount === 'number' ? ` / ${totalCount}` : ''}`;

      if (!data || data.length < PAGE_SIZE || (typeof totalCount === 'number' && currentOffset >= totalCount)) {
        finished = true;
        endMessage.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
      message.textContent = `查詢失敗：${err.message || err}`;
      finished = true;
    } finally {
      loadingNow = false;
      showLoading(false);
    }
  }

  function appendResults(rows) {
    const fragment = document.createDocumentFragment();

    rows.forEach((row) => {
      const node = template.content.cloneNode(true);
      node.querySelector('.term').textContent = row.term;
      node.querySelector('.meta').textContent = `ID: ${row.id} ｜ 韻母：${row.final_vowel}`;
      fragment.appendChild(node);
    });

    results.appendChild(fragment);
  }

  function setupInfiniteScroll() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first && first.isIntersecting) {
        fetchSameFinalVowelPage(searchToken);
      }
    }, {
      root: null,
      rootMargin: '300px 0px',
      threshold: 0
    });

    observer.observe(sentinel);
  }

  async function startSearch() {
    const raw = normalizeInput(termInput.value);
    resetUI();

    if (!raw) {
      message.textContent = '請先輸入詞語。';
      return;
    }

    currentLastChar = getLastCharacter(raw);
    searchInfo.textContent = `輸入詞語：${raw}　→　系統取最後一個字：${currentLastChar}`;

    searchBtn.disabled = true;
    const myToken = ++searchToken;

    try {
      const finalVowel = await lookupLastCharacterFinalVowel(currentLastChar);
      if (myToken !== searchToken) return;

      if (!finalVowel) {
        currentFinalVowel = null;
        finished = true;
        message.textContent = `系統沒有最後這個字-${currentLastChar}`;
        return;
      }

      currentFinalVowel = finalVowel;
      message.textContent = '';
      await fetchSameFinalVowelPage(myToken);
    } catch (err) {
      console.error(err);
      message.textContent = `查詢失敗：${err.message || err}`;
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await startSearch();
  });

  setupInfiniteScroll();
})();

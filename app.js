(function () {
  const { createClient } = window.supabase;

  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    document.getElementById('message').textContent = '尚未設定 config.js，請先填入 Supabase URL 與 anon key。';
    return;
  }

  const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const PAGE_SIZE = 80;
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
  let currentTone = null;
  let currentOffset = 0;
  let finished = false;
  let loadingNow = false;
  let totalCount = 0;
  let observer = null;
  let searchToken = 0;
  let sortedRows = [];

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
    currentTone = null;
    totalCount = 0;
    sortedRows = [];
  }

  function showLoading(show, text = '載入中…') {
    loading.textContent = text;
    loading.classList.toggle('hidden', !show);
  }

  function normalizeInput(value) {
    return value.trim();
  }

  function getLastCharacter(text) {
    const chars = Array.from(text);
    return chars.length ? chars[chars.length - 1] : '';
  }

  function toneGroup(tone) {
    const num = Number(tone);
    if (num === 1 || num === 2) return 'A';
    if (num === 3 || num === 4) return 'B';
    return 'Z';
  }

  function preferredGroupFromTone(tone) {
    return toneGroup(tone) === 'B' ? 'B' : 'A';
  }

  function toneLabel(tone) {
    const map = {
      0: '輕聲',
      1: '1聲',
      2: '2聲',
      3: '3聲',
      4: '4聲',
      5: '輕聲'
    };
    return map[tone] || '未標示';
  }

  function groupLabel(group) {
    return group === 'B' ? '3/4 聲優先' : '1/2 聲優先';
  }

  async function lookupLastCharacterInfo(lastChar) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('final_vowel, tone, weight, id')
      .eq('term', lastChar)
      .order('weight', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(1);

    if (error) throw error;
    return data && data.length ? data[0] : null;
  }

  async function fetchAndSortSameFinalVowel(token) {
    if (!currentFinalVowel) return;

    showLoading(true, '查詢並排序中…');

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, term, final_vowel, tone, weight')
      .eq('final_vowel', currentFinalVowel)
      .limit(20000);

    if (token !== searchToken) return;
    if (error) throw error;

    const preferredGroup = preferredGroupFromTone(currentTone);

sortedRows = (data || []).slice().sort((a, b) => {
  const aWeight = Number.isFinite(Number(a.weight)) ? Number(a.weight) : -1;
  const bWeight = Number.isFinite(Number(b.weight)) ? Number(b.weight) : -1;
  if (bWeight !== aWeight) return bWeight - aWeight;

  const queryTone = Number.isFinite(Number(currentTone)) ? Number(currentTone) : 99;
  const aTone = Number.isFinite(Number(a.tone)) ? Number(a.tone) : 99;
  const bTone = Number.isFinite(Number(b.tone)) ? Number(b.tone) : 99;

  // 第二排序：同 tone 優先
  const aSameTonePriority = aTone === queryTone ? 0 : 1;
  const bSameTonePriority = bTone === queryTone ? 0 : 1;
  if (aSameTonePriority !== bSameTonePriority) return aSameTonePriority - bSameTonePriority;

  // 第三排序：同組優先（1/2 一組，3/4 一組）
  const aGroupPriority = toneGroup(aTone) === preferredGroup ? 0 : 1;
  const bGroupPriority = toneGroup(bTone) === preferredGroup ? 0 : 1;
  if (aGroupPriority !== bGroupPriority) return aGroupPriority - bGroupPriority;

  // 第四排序：tone 數值
  if (aTone !== bTone) return aTone - bTone;

  // 第五排序：term
  const termCompare = String(a.term || '').localeCompare(String(b.term || ''), 'zh-Hant');
  if (termCompare !== 0) return termCompare;

  // 第六排序：id
  return Number(a.id) - Number(b.id);
});

    totalCount = sortedRows.length;
  }

  function appendNextPage() {
    if (finished || loadingNow) return;

    loadingNow = true;
    showLoading(true, '載入中…');

    const nextRows = sortedRows.slice(currentOffset, currentOffset + PAGE_SIZE);
    appendResults(nextRows);
    currentOffset += nextRows.length;

    const preferredGroup = preferredGroupFromTone(currentTone);
    stats.textContent = `最後字：${currentLastChar}　韻母：${currentFinalVowel}　聲調：${toneLabel(currentTone)}　排序：權重高到低，${groupLabel(preferredGroup)}　目前顯示：${currentOffset} / ${totalCount}`;

    if (currentOffset >= totalCount) {
      finished = true;
      endMessage.classList.remove('hidden');
    }

    loadingNow = false;
    showLoading(false);
  }

  function appendResults(rows) {
    const fragment = document.createDocumentFragment();

    rows.forEach((row) => {
      const node = template.content.cloneNode(true);
      node.querySelector('.term').textContent = row.term;
      node.querySelector('.meta').textContent = `韻母 ${row.final_vowel}｜${toneLabel(row.tone)}｜權重 ${row.weight ?? 0}`;
      fragment.appendChild(node);
    });

    results.appendChild(fragment);
  }

  function setupInfiniteScroll() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first && first.isIntersecting) {
        appendNextPage();
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
      const info = await lookupLastCharacterInfo(currentLastChar);
      if (myToken !== searchToken) return;

      if (!info) {
        currentFinalVowel = null;
        currentTone = null;
        finished = true;
        message.textContent = `系統沒有最後這個字-${currentLastChar}`;
        return;
      }

      currentFinalVowel = info.final_vowel;
      currentTone = info.tone;
      message.textContent = '';

      await fetchAndSortSameFinalVowel(myToken);
      if (myToken !== searchToken) return;

      if (!sortedRows.length) {
        finished = true;
        message.textContent = `找到了最後字 ${currentLastChar}，但沒有可顯示的同韻資料。`;
        return;
      }

      appendNextPage();
    } catch (err) {
      console.error(err);
      message.textContent = `查詢失敗：${err.message || err}`;
    } finally {
      searchBtn.disabled = false;
      showLoading(false);
    }
  }

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await startSearch();
  });

  setupInfiniteScroll();
})();

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
  let adjustedWeightIds = new Set();

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
    adjustedWeightIds = new Set();
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

  function buttonDisabledForRow(row) {
    return adjustedWeightIds.has(Number(row.id));
  }

  function updateStatsText() {
    stats.textContent = `最後字：${currentLastChar}　韻母：${currentFinalVowel}　聲調：${toneLabel(currentTone)}　排序：先依權重，再同聲優先，再同組優先　目前顯示：${currentOffset} / ${totalCount}`;
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

      const aSameTonePriority = aTone === queryTone ? 0 : 1;
      const bSameTonePriority = bTone === queryTone ? 0 : 1;
      if (aSameTonePriority !== bSameTonePriority) return aSameTonePriority - bSameTonePriority;

      const aGroupPriority = toneGroup(aTone) === preferredGroup ? 0 : 1;
      const bGroupPriority = toneGroup(bTone) === preferredGroup ? 0 : 1;
      if (aGroupPriority !== bGroupPriority) return aGroupPriority - bGroupPriority;

      if (aTone !== bTone) return aTone - bTone;

      const termCompare = String(a.term || '').localeCompare(String(b.term || ''), 'zh-Hant');
      if (termCompare !== 0) return termCompare;

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
    updateStatsText();

    if (currentOffset >= totalCount) {
      finished = true;
      endMessage.classList.remove('hidden');
    }

    loadingNow = false;
    showLoading(false);
  }

  function createWeightControls(row, itemRoot) {
    const wrap = document.createElement('div');
    wrap.className = 'weight-controls';

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'weight-btn';
    downBtn.textContent = '−';
    downBtn.title = '權重減 1';

    const weightValue = document.createElement('span');
    weightValue.className = 'weight-value';
    weightValue.textContent = String(row.weight ?? 0);

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'weight-btn';
    upBtn.textContent = '+';
    upBtn.title = '權重加 1';

    const disablePair = () => {
      downBtn.disabled = true;
      upBtn.disabled = true;
      itemRoot.classList.add('weight-locked');
    };

    if (buttonDisabledForRow(row)) {
      disablePair();
    }

    async function changeWeight(delta) {
      if (downBtn.disabled || upBtn.disabled) return;

      const currentWeight = Number.isFinite(Number(row.weight)) ? Number(row.weight) : 0;
      const newWeight = currentWeight + delta;

      if (newWeight < 0 || newWeight > 99) return;

      downBtn.disabled = true;
      upBtn.disabled = true;
      itemRoot.classList.add('weight-working');
      message.textContent = '';

      const { error } = await supabase
        .from(TABLE_NAME)
        .update({ weight: newWeight })
        .eq('id', row.id);

      itemRoot.classList.remove('weight-working');

      if (error) {
        downBtn.disabled = false;
        upBtn.disabled = false;
        message.textContent = `權重更新失敗（id=${row.id}）：${error.message || error}`;
        return;
      }

      row.weight = newWeight;
      weightValue.textContent = String(newWeight);
      const meta = itemRoot.querySelector('.meta');
      if (meta) {
        meta.textContent = `韻母 ${row.final_vowel}｜${toneLabel(row.tone)}｜權重 `;
        meta.appendChild(wrap);
      }
      adjustedWeightIds.add(Number(row.id));
      disablePair();
    }

    downBtn.addEventListener('click', () => changeWeight(-1));
    upBtn.addEventListener('click', () => changeWeight(1));

    if ((Number(row.weight) || 0) <= 0) {
      downBtn.disabled = true;
    }
    if ((Number(row.weight) || 0) >= 99) {
      upBtn.disabled = true;
    }

    wrap.appendChild(downBtn);
    wrap.appendChild(weightValue);
    wrap.appendChild(upBtn);
    return wrap;
  }

  function appendResults(rows) {
    const fragment = document.createDocumentFragment();

    rows.forEach((row) => {
      const node = template.content.cloneNode(true);
      const item = node.querySelector('.result-item');
      item.dataset.id = row.id;
      item.querySelector('.term').textContent = row.term;
      const meta = item.querySelector('.meta');
      meta.textContent = `韻母 ${row.final_vowel}｜${toneLabel(row.tone)}｜權重 `;
      meta.appendChild(createWeightControls(row, item));
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

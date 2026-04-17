(function () {
  const { createClient } = window.supabase;

  const TABLE_NAME = 'TblP03LexiconRhyme';
  const FEATURED_TABLE = 'TblP03FeaturedPairs';
  const PAGE_SIZE = 80;

  const message = document.getElementById('message');
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    message.textContent = '尚未設定 config.js，請先填入 Supabase URL 與 anon key。';
    return;
  }

  const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const searchForm = document.getElementById('searchForm');
  const termInput = document.getElementById('termInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchInfo = document.getElementById('searchInfo');
  const stats = document.getElementById('stats');
  const results = document.getElementById('results');
  const loading = document.getElementById('loading');
  const endMessage = document.getElementById('endMessage');
  const sentinel = document.getElementById('sentinel');
  const template = document.getElementById('resultItemTemplate');
  const randomButtons = Array.from(document.querySelectorAll('.random-btn'));
  const refreshRandomBtn = document.getElementById('refreshRandomBtn');
  const pronunciationPicker = document.getElementById('pronunciationPicker');

  let currentFinalVowel = null;
  let currentLastChar = null;
  let currentTone = null;
  let currentInputLength = 0;
  let currentQueryTerm = '';
  let currentOffset = 0;
  let finished = false;
  let loadingNow = false;
  let totalCount = 0;
  let observer = null;
  let searchToken = 0;
  let sortedRows = [];
  let adjustedWeightIds = new Set();
  let openEditorId = null;

  function resetUI() {
    searchInfo.textContent = '';
    message.textContent = '';
    stats.textContent = '';
    results.innerHTML = '';
    endMessage.classList.add('hidden');
    loading.classList.add('hidden');
    pronunciationPicker.classList.add('hidden');
    pronunciationPicker.innerHTML = '';
    finished = false;
    loadingNow = false;
    currentOffset = 0;
    currentTone = null;
    currentInputLength = 0;
    currentFinalVowel = null;
    currentLastChar = null;
    currentQueryTerm = '';
    totalCount = 0;
    sortedRows = [];
    adjustedWeightIds = new Set();
    openEditorId = null;
  }

  function showLoading(show, text = '載入中…') {
    loading.textContent = text;
    loading.classList.toggle('hidden', !show);
  }

  function normalizeInput(value) {
    return String(value || '').trim();
  }

  function getLastCharacter(text) {
    const chars = Array.from(text);
    return chars.length ? chars[chars.length - 1] : '';
  }

  function getTextLength(text) {
    return Array.from(String(text || '')).length;
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
    const map = { 0: '輕聲', 1: '1聲', 2: '2聲', 3: '3聲', 4: '4聲', 5: '輕聲' };
    return map[tone] || '未標示';
  }

  function readablePronunciation(row) {
    const bopomofo = normalizeInput(row?.bopomofo);
    if (bopomofo) return bopomofo;
    return `${row?.final_vowel || ''} ${toneLabel(row?.tone)}`.trim();
  }

  function buttonDisabledForRow(row) {
    return adjustedWeightIds.has(Number(row.id));
  }

  function updateStatsText() {
    stats.textContent = `查詢詞：${currentQueryTerm}　最後字：${currentLastChar}　韻母：${currentFinalVowel}　聲調：${toneLabel(currentTone)}　字數：${currentInputLength}　排序：先依權重，再同字數優先，再同聲優先，再同組優先　目前顯示：${currentOffset} / ${totalCount}`;
  }

  async function lookupExactTermInfos(term) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, term, final_vowel, tone, weight, bopomofo')
      .eq('term', term)
      .order('weight', { ascending: false, nullsFirst: false })
      .order('tone', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function lookupTermInfoById(id) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, term, final_vowel, tone, weight, bopomofo')
      .eq('id', id)
      .limit(1);

    if (error) throw error;
    return data && data.length ? data[0] : null;
  }

  async function lookupLastCharacterInfos(lastChar) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, term, final_vowel, tone, weight, bopomofo')
      .eq('term', lastChar)
      .order('weight', { ascending: false, nullsFirst: false })
      .order('tone', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function dedupePronunciations(rows) {
    const seen = new Set();
    const unique = [];
    rows.forEach((row) => {
      const key = `${row.final_vowel || ''}|${row.tone || ''}|${normalizeInput(row.bopomofo)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(row);
      }
    });
    return unique;
  }

  function applyPronunciationInfo(row, contextText) {
    currentFinalVowel = row.final_vowel;
    currentTone = row.tone;
    searchInfo.textContent = `${contextText}　→　使用發音：${readablePronunciation(row)}　→　韻母：${currentFinalVowel}　→　輸入字數：${currentInputLength}`;
  }

  function showPronunciationChoices(rows, token, contextText) {
    pronunciationPicker.innerHTML = '';
    pronunciationPicker.classList.remove('hidden');

    const intro = document.createElement('div');
    intro.className = 'pronunciation-intro';
    intro.textContent = `${contextText}　→　此字有多個可能讀音，請選擇：`;
    pronunciationPicker.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'pronunciation-options';

    rows.forEach((row) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pronunciation-btn';
      btn.textContent = readablePronunciation(row);
      btn.addEventListener('click', async () => {
        if (token !== searchToken) return;
        pronunciationPicker.classList.add('hidden');
        pronunciationPicker.innerHTML = '';
        applyPronunciationInfo(row, contextText);
        message.textContent = '';
        try {
          await fetchAndSortSameFinalVowel(token);
          if (token !== searchToken) return;
          if (!sortedRows.length) {
            finished = true;
            message.textContent = '找到了對應韻母，但沒有可顯示的同韻資料。';
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
      });
      list.appendChild(btn);
    });

    pronunciationPicker.appendChild(list);
  }

  async function fetchAndSortSameFinalVowel(token) {
    if (!currentFinalVowel) return;

    showLoading(true, '查詢並排序中…');

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('id, term, final_vowel, tone, weight, length')
      .eq('final_vowel', currentFinalVowel)
      .limit(20000);

    if (token !== searchToken) return;
    if (error) throw error;

    const preferredGroup = preferredGroupFromTone(currentTone);

    sortedRows = (data || []).slice().sort((a, b) => {
      const aWeight = Number.isFinite(Number(a.weight)) ? Number(a.weight) : -1;
      const bWeight = Number.isFinite(Number(b.weight)) ? Number(b.weight) : -1;
      if (bWeight !== aWeight) return bWeight - aWeight;

      const queryLength = Number.isFinite(Number(currentInputLength)) ? Number(currentInputLength) : 0;
      const aLength = Number.isFinite(Number(a.length)) ? Number(a.length) : 0;
      const bLength = Number.isFinite(Number(b.length)) ? Number(b.length) : 0;
      const aSameLengthPriority = aLength === queryLength ? 0 : 1;
      const bSameLengthPriority = bLength === queryLength ? 0 : 1;
      if (aSameLengthPriority !== bSameLengthPriority) return aSameLengthPriority - bSameLengthPriority;

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

  function createWeightControls(row, itemRoot, meta) {
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

    if (buttonDisabledForRow(row)) disablePair();

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
      meta.textContent = `韻母 ${row.final_vowel}｜${toneLabel(row.tone)}｜字數 ${row.length ?? ''}｜權重 `;
      meta.appendChild(wrap);
      adjustedWeightIds.add(Number(row.id));
      disablePair();
    }

    downBtn.addEventListener('click', () => changeWeight(-1));
    upBtn.addEventListener('click', () => changeWeight(1));

    if ((Number(row.weight) || 0) <= 0) downBtn.disabled = true;
    if ((Number(row.weight) || 0) >= 99) upBtn.disabled = true;

    wrap.appendChild(downBtn);
    wrap.appendChild(weightValue);
    wrap.appendChild(upBtn);
    return wrap;
  }

  function closeAllEditors() {
    document.querySelectorAll('.featured-editor').forEach((el) => {
      el.classList.add('hidden');
      el.innerHTML = '';
    });
    document.querySelectorAll('.select-btn').forEach((btn) => {
      if (btn.textContent !== '已選') btn.textContent = '選';
    });
    openEditorId = null;
  }

  async function saveFeaturedPair({ row, selectBtn, editorWrap, prefixOneInput, prefixTwoInput, saveBtn, cancelBtn }) {
    if (!currentQueryTerm) {
      message.textContent = '目前沒有有效的查詢詞，無法加入精選。';
      return;
    }

    const prefixOne = normalizeInput(prefixOneInput.value);
    const prefixTwo = normalizeInput(prefixTwoInput.value);
    const sourceTerm = `${prefixOne}${currentQueryTerm}`;
    const selectedTerm = `${prefixTwo}${String(row.term || '')}`;

    if (!sourceTerm || !selectedTerm) {
      message.textContent = '精選內容不可為空。';
      return;
    }

    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    selectBtn.disabled = true;
    message.textContent = '';

    const { data: existing, error: checkError } = await supabase
      .from(FEATURED_TABLE)
      .select('id')
      .eq('source_term', sourceTerm)
      .eq('selected_term', selectedTerm)
      .limit(1);

    if (checkError) {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      selectBtn.disabled = false;
      message.textContent = `精選查重失敗：${checkError.message || checkError}`;
      return;
    }

    if (existing && existing.length) {
      message.textContent = `這組精選已存在：${sourceTerm}，${selectedTerm}`;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      selectBtn.disabled = false;
      return;
    }

    const { error: insertError } = await supabase
      .from(FEATURED_TABLE)
      .insert({ source_term: sourceTerm, selected_term: selectedTerm });

    if (insertError) {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      selectBtn.disabled = false;
      if (String(insertError.message || '').toLowerCase().includes('duplicate')) {
        message.textContent = `這組精選已存在：${sourceTerm}，${selectedTerm}`;
      } else {
        message.textContent = `加入精選失敗：${insertError.message || insertError}`;
      }
      return;
    }

    message.textContent = `已加入精選：${sourceTerm}，${selectedTerm}`;
    selectBtn.textContent = '已選';
    editorWrap.classList.add('hidden');
    editorWrap.innerHTML = '';
    openEditorId = null;
  }

  function buildEditor(row, item, selectBtn) {
    const editorWrap = item.querySelector('.featured-editor');
    editorWrap.innerHTML = '';
    editorWrap.classList.remove('hidden');

    const editorInner = document.createElement('div');
    editorInner.className = 'featured-editor-inner';

    const prefixOneInput = document.createElement('input');
    prefixOneInput.type = 'text';
    prefixOneInput.maxLength = 30;
    prefixOneInput.placeholder = '前綴';
    prefixOneInput.className = 'prefix-input';

    const queryToken = document.createElement('span');
    queryToken.className = 'editor-fixed-term';
    queryToken.textContent = currentQueryTerm;

    const comma = document.createElement('span');
    comma.className = 'editor-comma';
    comma.textContent = '，';

    const prefixTwoInput = document.createElement('input');
    prefixTwoInput.type = 'text';
    prefixTwoInput.maxLength = 30;
    prefixTwoInput.placeholder = '前綴';
    prefixTwoInput.className = 'prefix-input';

    const selectedToken = document.createElement('span');
    selectedToken.className = 'editor-fixed-term';
    selectedToken.textContent = String(row.term || '');

    const preview = document.createElement('div');
    preview.className = 'editor-preview';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-featured-btn';
    saveBtn.textContent = '存入精選';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'cancel-featured-btn';
    cancelBtn.textContent = '取消';

    function refreshPreview() {
      const sourceTerm = `${normalizeInput(prefixOneInput.value)}${currentQueryTerm}`;
      const selectedTerm = `${normalizeInput(prefixTwoInput.value)}${String(row.term || '')}`;
      preview.textContent = `將存入：${sourceTerm}，${selectedTerm}`;
    }

    prefixOneInput.addEventListener('input', refreshPreview);
    prefixTwoInput.addEventListener('input', refreshPreview);

    saveBtn.addEventListener('click', () => saveFeaturedPair({
      row,
      selectBtn,
      editorWrap,
      prefixOneInput,
      prefixTwoInput,
      saveBtn,
      cancelBtn
    }));

    cancelBtn.addEventListener('click', () => {
      editorWrap.classList.add('hidden');
      editorWrap.innerHTML = '';
      if (selectBtn.textContent !== '已選') selectBtn.textContent = '選';
      openEditorId = null;
    });

    editorInner.appendChild(prefixOneInput);
    editorInner.appendChild(queryToken);
    editorInner.appendChild(comma);
    editorInner.appendChild(prefixTwoInput);
    editorInner.appendChild(selectedToken);
    editorInner.appendChild(saveBtn);
    editorInner.appendChild(cancelBtn);
    editorInner.appendChild(preview);

    editorWrap.appendChild(editorInner);
    refreshPreview();
    prefixOneInput.focus();
  }

  function toggleFeaturedEditor(row, item, selectBtn) {
    if (!currentQueryTerm) {
      message.textContent = '目前沒有有效的查詢詞，無法加入精選。';
      return;
    }

    const rowId = Number(row.id);
    const editorWrap = item.querySelector('.featured-editor');
    const alreadyOpen = !editorWrap.classList.contains('hidden') && openEditorId === rowId;

    if (alreadyOpen) {
      editorWrap.classList.add('hidden');
      editorWrap.innerHTML = '';
      if (selectBtn.textContent !== '已選') selectBtn.textContent = '選';
      openEditorId = null;
      return;
    }

    closeAllEditors();
    selectBtn.textContent = '收';
    openEditorId = rowId;
    buildEditor(row, item, selectBtn);
  }

  function appendResults(rows) {
    const fragment = document.createDocumentFragment();

    rows.forEach((row) => {
      const node = template.content.cloneNode(true);
      const item = node.querySelector('.result-item');
      const termEl = node.querySelector('.term');
      const meta = node.querySelector('.meta');
      const selectBtn = node.querySelector('.select-btn');

      item.dataset.id = row.id;
      termEl.textContent = row.term;
      termEl.title = `點選重新查詢：${row.term}`;
      termEl.classList.add('term-link');
      termEl.tabIndex = 0;

      meta.textContent = `韻母 ${row.final_vowel}｜${toneLabel(row.tone)}｜字數 ${row.length ?? ''}｜權重 `;
      meta.appendChild(createWeightControls(row, item, meta));

      termEl.addEventListener('click', async () => {
        await startSearch({ term: row.term, rowId: row.id });
      });
      termEl.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          await startSearch({ term: row.term, rowId: row.id });
        }
      });

      selectBtn.addEventListener('click', () => toggleFeaturedEditor(row, item, selectBtn));
      fragment.appendChild(node);
    });

    results.appendChild(fragment);
  }

  function setupInfiniteScroll() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first && first.isIntersecting) appendNextPage();
    }, {
      root: null,
      rootMargin: '300px 0px',
      threshold: 0
    });

    observer.observe(sentinel);
  }

  async function startSearch(explicitInput) {
    const explicitTerm = typeof explicitInput === 'object' && explicitInput !== null
      ? explicitInput.term
      : explicitInput;
    const explicitRowId = typeof explicitInput === 'object' && explicitInput !== null
      ? explicitInput.rowId
      : null;

    const raw = normalizeInput(explicitTerm ?? termInput.value);
    resetUI();

    if (!raw) {
      message.textContent = '請先輸入詞語。';
      return;
    }

    termInput.value = raw;
    currentQueryTerm = raw;
    currentInputLength = getTextLength(raw);
    currentLastChar = getLastCharacter(raw);

    searchBtn.disabled = true;
    const myToken = ++searchToken;

    try {
      if (explicitRowId != null) {
        const exactById = await lookupTermInfoById(explicitRowId);
        if (myToken !== searchToken) return;

        if (exactById) {
          applyPronunciationInfo(exactById, `輸入詞語：${raw}　→　系統依編號鎖定指定發音（id=${exactById.id}）`);
        } else {
          message.textContent = `找不到指定編號 id=${explicitRowId}，改用一般查詢。`;
        }
      }

      if (!currentFinalVowel) {
        const exactInfos = dedupePronunciations(await lookupExactTermInfos(raw));
        if (myToken !== searchToken) return;

        if (exactInfos.length) {
          const contextText = `輸入詞語：${raw}　→　系統直接找到整詞資料`;
          if (exactInfos.length === 1) {
            applyPronunciationInfo(exactInfos[0], contextText);
          } else {
            searchInfo.textContent = contextText;
            message.textContent = '';
            showPronunciationChoices(exactInfos, myToken, contextText);
            return;
          }
        } else {
          const contextText = `輸入詞語：${raw}　→　系統未找到整詞資料，改查最後一個字：${currentLastChar}`;
          const fallbackInfos = dedupePronunciations(await lookupLastCharacterInfos(currentLastChar));
          if (myToken !== searchToken) return;

          if (!fallbackInfos.length) {
            currentFinalVowel = null;
            currentTone = null;
            finished = true;
            searchInfo.textContent = contextText;
            message.textContent = `系統沒有最後這個字-${currentLastChar}`;
            return;
          }

          if (fallbackInfos.length === 1) {
            applyPronunciationInfo(fallbackInfos[0], contextText);
          } else {
            searchInfo.textContent = contextText;
            message.textContent = '';
            showPronunciationChoices(fallbackInfos, myToken, contextText);
            return;
          }
        }
      }

      message.textContent = '';
      await fetchAndSortSameFinalVowel(myToken);
      if (myToken !== searchToken) return;

      if (!sortedRows.length) {
        finished = true;
        message.textContent = '找到了對應韻母，但沒有可顯示的同韻資料。';
        return;
      }

      appendNextPage();
    } catch (err) {
      console.error(err);
      message.textContent = `查詢失敗：${err.message || err}`;
    } finally {
      if (!pronunciationPicker.classList.contains('hidden')) {
        showLoading(false);
      }
      searchBtn.disabled = false;
      showLoading(false);
    }
  }

  async function getRandomTermByLength(len) {
    const { count, error: countError } = await supabase
      .from(TABLE_NAME)
      .select('id', { count: 'exact', head: true })
      .eq('length', len);

    if (countError) throw countError;
    if (!count) return '';

    const offset = Math.floor(Math.random() * count);
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('term')
      .eq('length', len)
      .range(offset, offset);

    if (error) throw error;
    return data && data.length ? String(data[0].term || '') : '';
  }

  async function loadRandomButtons() {
    refreshRandomBtn.disabled = true;
    for (const btn of randomButtons) {
      btn.disabled = true;
      const len = Number(btn.dataset.length);
      btn.textContent = `${len}字：載入中…`;
    }

    try {
      for (const btn of randomButtons) {
        const len = Number(btn.dataset.length);
        const term = await getRandomTermByLength(len);
        btn.dataset.term = term;
        btn.textContent = term ? `${len}字：${term}` : `${len}字：無資料`;
        btn.disabled = !term;
      }
    } catch (err) {
      console.error(err);
      message.textContent = `隨機按鈕載入失敗：${err.message || err}`;
      for (const btn of randomButtons) {
        const len = Number(btn.dataset.length);
        btn.textContent = `${len}字：載入失敗`;
      }
    } finally {
      refreshRandomBtn.disabled = false;
    }
  }

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await startSearch();
  });

  randomButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const term = normalizeInput(btn.dataset.term || '');
      if (!term) return;
      await startSearch(term);
    });
  });

  refreshRandomBtn.addEventListener('click', async () => {
    await loadRandomButtons();
  });

  setupInfiniteScroll();
  loadRandomButtons();
})();

# P03 韻母查詢系統

這是一個可直接部署到 GitHub Pages 的靜態網站。

## 功能

- 輸入一個詞
- 系統自動取最後一個字
- 到 `TblP03LexiconRhyme.term` 查找該字
- 若找不到，顯示：`系統沒有最後這個字-X`
- 若找到，取出 `final_vowel`
- 顯示所有同 `final_vowel` 的詞
- 使用 Infinite Scroll 逐頁載入，避免一次載入大量資料

## 檔案

- `index.html`：主頁面
- `style.css`：樣式
- `app.js`：查詢與無限捲動邏輯
- `config.example.js`：Supabase 設定範本

## 使用方式

1. 將 `config.example.js` 複製為 `config.js`
2. 填入您的：
   - Supabase Project URL
   - Supabase anon key
3. 上傳全部檔案到 GitHub repository
4. 在 GitHub repository 的 **Settings → Pages** 啟用 GitHub Pages
5. Source 選擇 `main` branch，資料夾選 `/root`

## Supabase 必要條件

前端查詢要成功，資料表需要允許匿名讀取。至少要有對 `TblP03LexiconRhyme` 的 `SELECT` policy。

例如：

```sql
alter table "TblP03LexiconRhyme" enable row level security;

create policy "Allow public read on TblP03LexiconRhyme"
on "TblP03LexiconRhyme"
for select
using (true);
```

## 建議索引

```sql
create index if not exists idx_tblp03lexiconrhyme_term
on "TblP03LexiconRhyme" (term);

create index if not exists idx_tblp03lexiconrhyme_final_vowel
on "TblP03LexiconRhyme" (final_vowel);
```

## 備註

- `app.js` 目前採用「找到第一筆符合 `term = 最後一字` 的資料，就取其 `final_vowel`」的邏輯。
- 若未來要處理多音字，可再改成：
  - 顯示多個候選韻母供使用者選擇，或
  - 依詞語整體建立更細的音韻資料表。

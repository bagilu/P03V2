# P03 韻母查詢系統 v4

這是一個可直接部署到 GitHub Pages 的靜態網站，配合 Supabase 使用。

## 功能

### 主查詢頁
- 輸入詞語後，系統會取最後一個字，到 `TblP03LexiconRhyme` 查詢其 `final_vowel` 與 `tone`
- 顯示所有相同 `final_vowel` 的詞語
- 排序規則：
  1. `weight` 由大到小
  2. 與查詢詞同字數優先
  3. 與查詢字同 `tone` 優先
  4. 與查詢字同聲調組優先（1/2 一組、3/4 一組）
  5. 再依 `tone`、`term`、`id`
- 採用 Infinite Scroll 分批顯示
- 每筆結果可用 `− / +` 微調 `weight`，每次只增減 1，成功後該列停用
- 每筆結果右側有 `選` 按鈕，可將 `source_term + selected_term` 加入精選資料表
- 查詢框下方有四個隨機按鈕，分別抽出 1、2、3、4 字詞
- 提供 `換一批` 按鈕重新抽樣

### 精選頁
- 顯示 `TblP03FeaturedPairs` 內容
- 排序規則：
  1. `likes_count DESC`
  2. `created_at DESC`
- 每筆資料可按讚
- 使用 `localStorage` 記錄，同一瀏覽器對同一筆資料只能按一次

## 檔案
- `index.html`：主查詢頁
- `featured.html`：精選頁
- `app.js`：主查詢頁邏輯
- `featured.js`：精選頁邏輯
- `style.css`：共用樣式
- `config.example.js`：Supabase 設定範本

## 使用方式
1. 將 `config.example.js` 複製為 `config.js`
2. 填入您的 Supabase Project URL 與 anon key
3. 將檔案上傳到 GitHub repository
4. 到 GitHub 的 `Settings → Pages` 啟用 GitHub Pages

## Supabase 資料表

### 詞表
- 表名：`TblP03LexiconRhyme`
- 主要欄位：
  - `id`
  - `term`
  - `final_vowel`
  - `tone`
  - `weight`
  - `length`

### 精選表
- 表名：`TblP03FeaturedPairs`
- 欄位：
  - `id`
  - `source_term`
  - `selected_term`
  - `created_at`
  - `likes_count`

## 建議 RLS / Policy

若前端要直接查詢、更新與新增，至少需開放以下權限。

```sql
alter table "TblP03LexiconRhyme" enable row level security;
alter table "TblP03FeaturedPairs" enable row level security;

create policy "Allow public read lexicon"
on "TblP03LexiconRhyme"
for select
using (true);

create policy "Allow public update lexicon"
on "TblP03LexiconRhyme"
for update
using (true)
with check (true);

create policy "Allow public read featured"
on "TblP03FeaturedPairs"
for select
using (true);

create policy "Allow public insert featured"
on "TblP03FeaturedPairs"
for insert
with check (true);

create policy "Allow public update featured"
on "TblP03FeaturedPairs"
for update
using (true)
with check (true);
```

## 建議索引

```sql
create index if not exists idx_tblp03lexiconrhyme_term
on "TblP03LexiconRhyme" (term);

create index if not exists idx_tblp03lexiconrhyme_final_vowel
on "TblP03LexiconRhyme" (final_vowel);

create index if not exists idx_tblp03lexiconrhyme_length
on "TblP03LexiconRhyme" (length);

create index if not exists idx_tblp03featuredpairs_likes_created
on "TblP03FeaturedPairs" (likes_count desc, created_at desc);
```

## 注意
- 隨機按鈕目前會依 `length = 1/2/3/4` 各抽一筆
- 若某個字數沒有資料，按鈕會顯示無資料
- 精選加入前，前端會先查重；資料表也有 `UNIQUE (source_term, selected_term)` 約束
- 按讚防重複目前是同一瀏覽器層級，不是帳號層級

# Santa 單字室

86 個英文單字的翻字卡與四選一複習網站。介面使用繁體中文，支援手機與桌面，靜態網頁可部署於 GitHub Pages。

**線上使用：[Santa 單字室](https://jeffhome5370.github.io/santa-vocabulary/)**

原始碼：[Jeffhome5370/santa-vocabulary](https://github.com/Jeffhome5370/santa-vocabulary)。

## 功能

- 點擊或按空白鍵翻卡，方向鍵切換字卡；可切換英文或中文正面。
- 每個單字有詞性、中文意思、原創英文例句與中文翻譯。
- 標記「已熟悉／待加強」，篩選尚未複習、待加強、收藏，以及隨機排序。
- 每回 10 題四選一；優先安排錯題，再安排尚未複習的單字。每題作答後立即提供正解與例句。
- 單字庫完整列出 86 個單字，可搜尋英文、中文與用法，依熟悉程度／收藏篩選、A–Z 排序，並直接進入指定字卡。
- 在單字庫按「＋ 新增單字」：英文與中文意思必填，詞性、英文例句、翻譯及筆記選填；每個帳號／訪客最多新增 500 詞，相同英文與意思會阻止重複加入。
- 自訂單字納入搜尋、翻卡、選擇題、總數及 JSON／Markdown 備份，可用「我的自訂單字」篩選。登入後跟隨個人進度同步，只有本人可讀寫；訪客新增先存於此瀏覽器，可於登入後主動合併。
- Supabase Email 註冊、登入、忘記密碼與密碼重設流程；需完成下方雲端服務設定才能啟用。
- 訪客進度儲存在瀏覽器；登入後，帳號紀錄自動同步至 Supabase，各帳號分開保存。
- 訪客紀錄須經使用者主動選擇，才會合併至登入的帳號。
- 支援 JSON 匯出／匯入及 Markdown 複習紀錄匯出；舊版 v1 備份會自動轉換為 v2。
- 多裝置以獨立計數器合併作答次數；重複同步／匯入不會重複計算。熟悉程度與收藏各按其更新時間合併。

## 啟用帳號登入與雲端儲存

正式網站已連接 Supabase 專案 `igpgvylzfnbdfcvktjww`（Tokyo），資料庫、RLS 與公開設定已完成，並已啟用 Email 帳號流程。Site URL 與允許返回網址均為上方 GitHub Pages 網址。註冊採伺服器端 Email 白名單：名單存在私有 schema，真實地址不納入公開原始碼。個人密碼與驗證步驟由使用者自行完成。

以下步驟供重新部署至其他專案時使用。未填公開設定時，介面會明確顯示「帳號登入尚未開放」，訪客功能照常運作。

1. 在自己的 Supabase 專案依檔名順序執行 [資料庫 migrations](supabase/migrations/)。它們建立每個使用者一列的私有進度資料、RLS 政策、具有版本檢查的同步函式、防止舊版頁面覆蓋自訂單字的保護及私有 Email 白名單。正式專案已套用這三份 migration。
2. 在 **Authentication → URL Configuration** 將 Site URL 設為 `https://jeffhome5370.github.io/santa-vocabulary/`，並將同一網址加入 Redirect URLs。使用其他部署網址時同步修改。
3. 在 **Authentication → Providers** 啟用 Email／Password，保留 Email 驗證。要對外開放註冊與寄送重設密碼信，應依 Supabase 文件設定自己的 SMTP；預設寄信服務限制收件人與速率，不適合作為公開網站的完整寄信服務。
4. 取得 Project URL 與 publishable key，填入 `dist/config.js`。舊式 `anon` key 也支援。這兩個值是瀏覽器公開設定，資料保護依靠登入 JWT 與資料庫 RLS。
5. **不要放入 `service_role`、`sb_secret_`、資料庫密碼或管理員 token。**
6. 部署後用自己控制的 Email 完成註冊、驗證與登入。確認顯示「已同步至雲端」，再於另一瀏覽器登入確認進度；測試帳號 A 看不到帳號 B 的紀錄。

## 指定 Email 白名單與寄信

第三份 migration 建立 `santa_private.signup_allowlist` 及 `check_signup_allowlist(jsonb)`，必須另於 **Authentication → Auth Hooks → Before User Created** 啟用該 Postgres 函式。正式專案已啟用並以真實註冊 API 驗證非白名單回傳 403。白名單以完整 Email 比對，不區分大小寫；新專案執行 migration 時只保留當時已驗證的現有帳號。

新增地址請由管理者在 Supabase SQL Editor 操作私有資料表，不要把真實名單加入公開 migration、前端或 Git 歷史。只有 Auth 服務可以讀取名單；一般登入者與匿名訪客不能讀寫。此 Hook 限制新註冊，停用一筆白名單不會自動撤銷已建立帳號或現有登入工作階段；若要停權，還須處理 Auth 帳號及授權。

寄信選用 Gmail SMTP（`smtp.gmail.com`、587、STARTTLS），寄件人與 SMTP 使用者使用同一 Gmail。密碼使用 Google 的應用程式密碼，由管理者親自在 Supabase 後台輸入；不可使用一般 Google 登入密碼，也不可放入本儲存庫。應用程式密碼需先啟用 Google 兩步驟驗證。**目前仍待管理者完成憑證輸入、儲存及寄信實測，不能視為 SMTP 已可用。**

參考：[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)、[Google 應用程式密碼](https://support.google.com/accounts/answer/185833)。

```js
export const CLOUD_CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  publishableKey: 'sb_publishable_YOUR_PUBLIC_KEY',
});
```

SQL 使用 `auth.uid()` 限定帳號，匿名訪客無讀寫權限；同步使用原子版本檢查與重試，避免覆蓋另一裝置剛寫入的紀錄。自訂字庫存在進度 JSON 的 `customWords`，使用穩定的獨立編號，不會改動原始 86 詞。舊備份仍可匯入；較舊的開啟中頁面若缺少雲端自訂字庫，伺服器會拒絕覆蓋，請重新整理後再同步。

參考：[Supabase Email 登入](https://supabase.com/docs/guides/auth/passwords)、[API keys](https://supabase.com/docs/guides/api/api-keys)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 本機預覽

需要 Python 3。於專案資料夾執行：

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

瀏覽 <http://127.0.0.1:4173>。按 `Ctrl+C` 關閉伺服器。

也可使用其他靜態 HTTP 伺服器。因為使用 JavaScript modules，請透過 HTTP 預覽，不要直接以 `file://` 開啟 HTML。

## 檢查

需要 Node.js 22 或更新版本。測試使用 PGlite 在記憶體中執行真正的 PostgreSQL migration，不會連線至正式資料庫。

```powershell
npm ci
npm test
npm run check
```

測試涵蓋字卡、題目、舊備份轉換、多裝置計數、併發同步、離線與伺服器錯誤、帳號切換競態，以及資料庫的匿名拒絕、帳號隔離與舊版本寫入拒絕。這些測試不取代正式專案的註冊、寄信與登入驗證。

## GitHub Pages 部署

1. 在自己的 GitHub 帳號建立名為 `santa-vocabulary` 的公開儲存庫。
2. 將此專案內容提交並推送至 `main` 分支。
3. 在儲存庫 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**。
4. 在 **Actions → Test and deploy Santa vocabulary → Run workflow** 執行部署，或再推送一次更新。
5. 等待 workflow 成功，Pages 設定頁會顯示實際網址。

```powershell
git init -b main
git add .
git commit -m "Build Santa vocabulary flashcards and quizzes"
git remote add origin https://github.com/YOUR_USERNAME/santa-vocabulary.git
git push -u origin main
```

若本機 Git 已登入相同帳號，可選用 `scripts/github_deploy.py` 建立儲存庫或啟用 Pages。該腳本僅透過 Git 設定的 credential helper 取得登入，憑證只留在程序記憶體，不寫入檔案或輸出。

GitHub Pages 工作流程採用 GitHub 的[靜態網站部署範例](https://github.com/actions/starter-workflows/blob/main/pages/static.yml)，只發布 `dist/`，不發布筆記、測試或個人進度備份。

## 更新單字

單字來源保存在 `data/vocabulary.md`，範例句與修正資料在 `scripts/build_data.py`。調整後執行：

```powershell
python scripts/build_data.py
```

若要從原本的單字筆記更新表格，可指定來源：

```powershell
python scripts/build_data.py --source "..\Santa單字.md"
```

目前產生器驗證 86 筆編號；新增單字時，也須同步擴充詞性、例句與筆數檢查。直接編輯 `dist/data.js` 亦可，但下次執行產生器會覆蓋這些變更。保持既有 `id` 不變，才能延續已儲存的複習進度。

## 進度與資料

- 公開網站只有單字內容，不內建個人複習歷史。
- 訪客進度不會上傳雲端；登入且顯示同步成功後，帳號紀錄才已保存到 Supabase。
- 清除瀏覽器資料後，登入同一帳號即可取回已同步紀錄。尚未同步、離線新增或訪客紀錄仍需先匯出 JSON。
- 進度不會寫入公開 GitHub 儲存庫，也不會自動回寫本機 Markdown。
- 各帳號的本機快取分開保存，登出後切回訪客紀錄。網頁提供的重設只清除訪客進度，不會刪除雲端資料。
- 目前保留最近 500 筆逐次紀錄；各單字累計複習次數仍會保留。測驗正確率以保留的選擇題紀錄計算，不包含翻卡自評。
- 請在清除瀏覽器資料前備份；隱私模式可能不保留進度。
- 「已熟悉」代表最近一次答對或自評熟悉，不代表永久掌握。
- 英文朗讀依瀏覽器與裝置語音支援；部分裝置可能需要網路。
- 字體使用 Google Fonts，無法連線時使用系統字體。設定雲端功能後，登入時會載入固定版本的 Supabase JS SDK（2.118.0，jsDelivr），並連線至設定的 Supabase 專案。
- 累計次數以每個頁面／帳號練習階段的獨立計數器合併，超過 500 筆的舊歷史不影響總次數。每個帳號狀態限制為 2 MB，以免異常檔案造成過量儲存。

來源：[Quizlet「Santa單字」](https://quizlet.com/tw/1215722156/santa%E5%96%AE%E5%AD%97-flash-cards/)。保留原筆記的學習註記，修正 recurrence、courtesy 與 Highness 等容易記錯的條目。

# DINOTAENG 美編試作分支

- 分支：`codex/dinotaeng-design`。等待使用者認可後才合併，未開啟自動合併。
- 正式站：https://jeffhome5370.github.io/santa-vocabulary/
- 美編預覽：https://jeffhome5370.github.io/santa-vocabulary/preview/dinotaeng/

這是完整網站的美編版本，保留目前 main 的登入／註冊／重設密碼、帳號同步、新增／編輯／可復原刪除單字、AI 建議與例句、收藏、所有測驗方向、進度備份與匯入、Markdown 匯出與跨裝置衝突處理。

## 使用與資料

兩個網址同網域、使用相同帳號服務及本機進度格式。以原帳號登入可使用原有字庫與學習資料；在預覽版修改字卡或練習，會更新同一份個人資料。這是介面試作，沒有建立另外一套測試帳號資料庫。

Email 驗證與重設密碼仍返回已設定的正式站網址，完成後可返回預覽版登入。預覽維持與正式站相同的網域，讓既有 AI 服務的來源限制保持有效。

字卡英文及例句可點擊朗讀，空白處翻面。單字標題直接開啟原有編輯表單，同時保留例句展開、收藏、翻卡捷徑、刪除及復原。上方只呈現單字總數與已熟悉數；待加強及測驗正確率仍可在單字篩選和成長日記查看。每日小目標按台北日期對正確作答的單字去重。

## 部署

`.github/workflows/dinotaeng-preview.yml` 僅針對美編分支執行。工作流程會：

1. 分別取出最新 `main` 及美編分支。
2. 執行完整測試與語法檢查。
3. 把 `main/dist/` 原樣放在網站根目錄，美編 `dist/` 放在 `preview/dinotaeng/`。
4. 透過同一 GitHub Pages 發布兩個路徑，不將試作內容合併至 main。

GitHub Pages 每個儲存庫只有一個網站，因此這是不同路徑的預覽網址。日後 main 原有部署流程執行時，會覆蓋整個 Pages artifact；若預覽暫時消失，從本分支重新執行 DINOTAENG design preview 工作流程即可恢復。正式站根目錄始終從當時 main 的 dist 建置。

原本 `pages.yml` 在此分支加上 main 條件，避免手動在美編分支執行該工作流程而把試作當作正式站。

## 驗證與素材

`npm test` 目前共 44 項測試，包含既有 PostgreSQL 隔離、同步衝突、字卡管理與 AI 保護，另加每日目標去重／跨日測試。`npm run check` 檢查全部原有及新 JavaScript。

`dist/assets/dinotaeng/SOURCES.md` 保存素材來源。圖片採本機 WebP，不需要從 LINE 商店載入；原始完整素材庫及個人資料未加入儲存庫。

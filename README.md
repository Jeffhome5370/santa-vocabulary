# Santa 單字室

86 個英文單字的翻字卡與四選一複習網站。介面使用繁體中文，支援手機與桌面，無需安裝前端依賴。

## 功能

- 點擊或按空白鍵翻卡，方向鍵切換字卡；可切換英文或中文正面。
- 每個單字有詞性、中文意思、原創英文例句與中文翻譯。
- 標記「已熟悉／待加強」，篩選尚未複習、待加強、收藏，以及隨機排序。
- 每回 10 題四選一；優先安排錯題，再安排尚未複習的單字。每題作答後立即提供正解與例句。
- 單字庫可搜尋英文、中文與用法。
- 使用瀏覽器 localStorage 保存進度；支援 JSON 匯出／匯入及 Markdown 複習紀錄匯出。
- JSON 匯入依各單字的更新時間合併，同一檔案重複匯入不會增加複習次數。

## 本機預覽

需要 Python 3。於專案資料夾執行：

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory dist
```

瀏覽 <http://127.0.0.1:4173>。按 `Ctrl+C` 關閉伺服器。

也可使用其他靜態 HTTP 伺服器。因為使用 JavaScript modules，請透過 HTTP 預覽，不要直接以 `file://` 開啟 HTML。

## 檢查

需要 Node.js 22 或更新版本。沒有 npm 依賴，不需執行 `npm install`。

```powershell
npm test
npm run check
```

測試涵蓋字卡完整性、每題選項唯一性、錯題優先順序、進度統計、重複備份匯入與損壞資料處理。

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
- 進度不會上傳 GitHub，也不會自動同步裝置或回寫本機 Markdown。
- 需要跨裝置時，在學習紀錄匯出 JSON，再於新裝置匯入。
- 目前保留最近 500 筆逐次紀錄；各單字累計複習次數仍會保留。測驗正確率以保留的選擇題紀錄計算，不包含翻卡自評。
- 請在清除瀏覽器資料前備份；隱私模式可能不保留進度。
- 「已熟悉」代表最近一次答對或自評熟悉，不代表永久掌握。
- 英文朗讀依瀏覽器與裝置語音支援；部分裝置可能需要網路。
- 字體使用 Google Fonts；無法連線時會使用系統字體。其餘網站功能無需第三方 API。

來源：[Quizlet「Santa單字」](https://quizlet.com/tw/1215722156/santa%E5%96%AE%E5%AD%97-flash-cards/)。保留原筆記的學習註記，修正 recurrence、courtesy 與 Highness 等容易記錯的條目。

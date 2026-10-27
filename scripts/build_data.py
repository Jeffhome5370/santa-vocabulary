"""Rebuild the static deck from the Markdown vocabulary table (no review records)."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=ROOT / 'data' / 'vocabulary.md')
args = parser.parse_args()
rows = []
for line in args.source.read_text(encoding='utf-8').splitlines():
    if re.match(r'^\| \d+ \|', line):
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) == 4:
            rows.append(cells)
assert len(rows) == 86, f'Expected 86 vocabulary entries, got {len(rows)}'
assert [int(row[0]) for row in rows] == list(range(1, 87))

parts = 'adj. n. n. adv. v. v. v. v. v. n. n. n. prep. n. n. n./v. phr. n. n. n. n./v. n./v. adj. adj. adj. adj. adv. n./v. n. adv. adv. n./v. n. n. v. n. n. n. n. n. adj. v. n./v. n. adj. n. phr.v. phr. n. adj. n. n. n. n. n. n. n. n. phr. n. n. v. n./v. v. n./adj. n. n. adj. v. n./v. adj. adj. adj. adj. n./v. n. n. n. n. n. phr. adj. n./v. v. n. v.'.split()
assert len(parts) == 86
meanings = {
    9: '理解、領會', 10: '慣例；大會、會議', 11: '活動、會議或課程的一段時間',
    12: '設施、供特定用途的場所', 22: '節錄、摘錄', 30: '勉強；幾乎不',
    35: '報銷、償付費用', 37: '主動性；倡議、措施', 45: '鮮豔的；充滿活力的',
    48: '除了……之外，還……', 53: '再次發生、復發、重現', 61: '禮貌、禮遇',
    71: '反映的；反光的；沉思的', 74: '住宅的、居住用的',
    82: '免費的；讚美的', 83: '贊同；幫忙、恩惠', 84: '承受、抵擋',
    85: '殿下（王室稱謂）',
}
# Original examples, written for this learning deck. Order matches the Markdown IDs.
examples = '''The team proposed an innovative solution.|團隊提出了一個創新的解決方案。
We discussed every aspect of the plan.|我們討論了這個計畫的每個方面。
This substance dissolves in water.|這種物質會溶於水。
You are cordially invited to our opening ceremony.|誠摯邀請您參加我們的開幕典禮。
The results reflect our hard work.|這些成果反映了我們的努力。
I suppose the meeting will end at noon.|我想會議會在中午結束。
We appreciate your support.|我們感謝您的支持。
Can you recommend a good restaurant?|你能推薦一家好餐廳嗎？
I could not comprehend the instructions.|我無法理解這些指示。
The annual convention takes place in Taipei.|年度大會在台北舉行。
The training session lasts two hours.|這場訓練持續兩個小時。
The company opened a new research facility.|公司啟用了一座新的研究設施。
She found the letter among the documents.|她在文件之中找到了那封信。
The chef gave a cooking demonstration.|主廚進行了一場烹飪示範。
Please give this proposal careful consideration.|請仔細考慮這項提案。
The main feature of this app is its simple design.|這個應用程式的主要特色是簡潔的設計。
Some fruits, for instance apples, are easy to store.|有些水果，例如蘋果，很容易存放。
The tenant pays rent on the first of each month.|房客在每月一日繳交房租。
Better benefits can reduce the turnover rate.|更好的福利可以降低員工離職率。
Heat can affect the formation of crystals.|熱會影響晶體的形成。
The film received international acclaim.|這部電影獲得了國際讚譽。
She read an excerpt from her new book.|她朗讀了新書的一段節錄。
We have adequate time to finish the project.|我們有足夠的時間完成這個專案。
Please handle this fragile glass with care.|請小心拿取這個易碎的玻璃杯。
The town has a thriving local market.|這座城鎮有個繁榮的在地市場。
We need a precise estimate of the cost.|我們需要精確的成本估算。
It was raining; nonetheless, they continued working.|當時正在下雨，儘管如此，他們仍繼續工作。
The product is available for a free trial.|這項產品可供免費試用。
There is a surcharge for express delivery.|快遞配送需支付額外費用。
We barely had enough time to catch the train.|我們勉強來得及趕上火車。
The staff responded swiftly to the request.|工作人員迅速回應了這項請求。
The lease expires at the end of the year.|租約將於年底到期。
This appliance uses very little electricity.|這台家用電器耗電量很少。
The park is popular with city dwellers.|這座公園很受城市居民歡迎。
The company will reimburse you for travel expenses.|公司將報銷你的差旅費。
Thank you for your contribution to the project.|感謝你對這個專案的貢獻。
She took the initiative to contact the client.|她主動聯繫了客戶。
We booked a venue for the conference.|我們預訂了會議場地。
The hotel is closed for renovation.|飯店因整修而暫停營業。
The office needs a complete refurbishment.|這間辦公室需要全面翻新。
We need an unbiased opinion.|我們需要一個公正的意見。
Please do not interfere with their work.|請不要妨礙他們的工作。
The usher showed us to our seats.|招待員帶我們到座位上。
The company is part of a large conglomerate.|這家公司隸屬於一家大型企業集團。
The artist uses vibrant colors.|這位藝術家使用鮮豔的色彩。
The airline is expanding its fleet.|這家航空公司正在擴充機隊。
She will take over as manager next month.|她下個月將接任經理。
In addition to lunch, the fee includes transportation.|除了午餐之外，這筆費用還包含交通。
The speaker received an honorarium.|演講者收到了一筆酬勞金。
The disease is highly contagious.|這種疾病具有高度傳染性。
Employees receive a monthly travel allowance.|員工每月可領取交通津貼。
The invention sparked a revolution in communication.|這項發明引發了通訊革命。
Regular maintenance can prevent a recurrence of the problem.|定期維護可以防止問題再次發生。
The company reported an increase in pre-tax profit.|公司報告稅前利潤增加。
The project requires skilled labor.|這個專案需要技術勞工。
She has the ability to solve complex problems.|她有解決複雜問題的能力。
You will receive a certificate after the course.|完成課程後，你將獲得證書。
The course puts emphasis on practical skills.|這門課程著重實用技能。
We place an emphasis on quality.|我們把重點放在品質上。
He has no intention of leaving the company.|他沒有離開公司的打算。
Please treat every customer with courtesy.|請以禮貌對待每位顧客。
The new lighting will enhance the room's appearance.|新的照明將改善房間的外觀。
Please outline the main points of your proposal.|請概述你提案的重點。
The rules restrict access to this area.|這些規定限制進入這個區域。
Read the manual before using the machine.|使用機器前請先閱讀說明書。
Safety is everyone's responsibility.|安全是每個人的責任。
The building has a clear evacuation plan.|這棟建築有明確的疏散計畫。
The camera is small and inconspicuous.|這台攝影機小巧且不顯眼。
The researchers hope to unearth new evidence.|研究人員希望發掘新的證據。
We endeavor to provide excellent service.|我們努力提供優質服務。
The sign has a reflective surface.|這個標誌有反光的表面。
The projected cost is two million dollars.|預計費用為兩百萬元。
The clinic uses disposable gloves.|這間診所使用拋棄式手套。
The school is in a residential area.|這所學校位於住宅區。
The bank has an affiliate in Singapore.|這家銀行在新加坡有一家關係企業。
Proper waste disposal protects the environment.|妥善處理廢棄物能保護環境。
You can use this voucher at any branch.|你可以在任何分店使用這張禮券。
The pamphlet explains how to apply.|這本小冊子說明了申請方式。
An anonymous donor paid for the equipment.|一位匿名捐贈者支付了設備費用。
The receptionist greeted us with a smile.|接待員微笑迎接我們。
The store is holding a clearance sale.|這家商店正在舉辦清倉大拍賣。
Guests receive a complimentary breakfast.|住客可享用免費早餐。
Could you do me a favor?|你能幫我一個忙嗎？
This material can withstand high temperatures.|這種材料能承受高溫。
Your Highness, the guests have arrived.|殿下，賓客們已經抵達。
Please do not disturb the other guests.|請不要打擾其他房客。'''.splitlines()
assert len(examples) == 86
words = []
for row, pos, example in zip(rows, parts, examples):
    number, original, meaning, note = row
    word_id = int(number)
    word = 'recurrence' if word_id == 53 else original.lower()
    if word_id == 85:
        word = 'Highness'
    clean_meaning = re.sub(r'^(?:\([^)]*\)\s*|(?:v\./n\.|n\.|v\.))', '', meaning).strip()
    en, zh = example.split('|')
    words.append(dict(id=word_id, word=word, pos=pos, meaning=meanings.get(word_id, clean_meaning),
                      note=note, example=en, translation=zh))
(ROOT / 'dist' / 'data.js').write_text('export const WORDS = ' + json.dumps(words, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
print(f'Built {len(words)} cards with corrected vocabulary and bilingual examples.')

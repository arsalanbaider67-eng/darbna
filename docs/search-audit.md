# Darbna search audit (2026-10-15)

## Providers on their own

Hit = one of the top 5 results is in the right city (within 25 km). 53 queries.

| Provider | Hits | Errors |
|---|---|---|
| nominatim | 45/53 (85%) | 0 |
| photon | 2/53 (4%) | 50 (The operation was aborted due to timeout) |
| esri | 46/53 (87%) | 0 |

By kind:

| Kind | nominatim | photon | esri |
|---|---|---|---|
| neighbourhood (9) | 9 | 0 | 8 |
| variant (3) | 2 | 1 | 2 |
| typo (1) | 0 | 0 | 1 |
| street (3) | 3 | 0 | 3 |
| landmark (21) | 17 | 1 | 17 |
| school (12) | 11 | 0 | 12 |
| hospital (1) | 1 | 0 | 0 |
| business (3) | 2 | 0 | 3 |

By language:

| Language | nominatim | photon | esri |
|---|---|---|---|
| ar (35) | 27 | 2 | 30 |
| ckb (4) | 4 | 0 | 3 |
| en (14) | 14 | 0 | 13 |

Every query:

| Query | City | nominatim | photon | esri |
|---|---|---|---|---|
| الكرادة | baghdad | ✓ #1 | error | ✓ #4 |
| الكراده | baghdad | ✓ #1 | ✓ #1 | ✗ (none) |
| المنصور | baghdad | ✓ #1 | error | ✓ #3 |
| المنصوور | baghdad | ✗ (none) | error | ✓ #3 |
| الكاظمية | baghdad | ✓ #1 | error | ✓ #1 |
| زيونة | baghdad | ✓ #1 | error | ✓ #1 |
| شارع المتنبي | baghdad | ✓ #1 | error | ✓ #1 |
| شارع فلسطين | baghdad | ✓ #1 | error | ✓ #1 |
| ساحة التحرير | baghdad | ✓ #1 | ✓ #1 | ✓ #1 |
| مطار بغداد الدولي | baghdad | ✓ #1 | error | ✓ #1 |
| Baghdad International Airport | baghdad | ✓ #1 | error | ✓ #1 |
| جامعة بغداد | baghdad | ✓ #1 | error | ✓ #1 |
| مدينة الطب | baghdad | ✓ #1 | error | ✗ (none) |
| Al-Mansour | baghdad | ✓ #1 | error | ✓ #1 |
| قلعة أربيل | erbil | ✓ #1 | error | ✓ #1 |
| قلعة اربيل | erbil | ✓ #1 | error | ✓ #1 |
| Erbil Citadel | erbil | ✓ #1 | error | ✓ #1 |
| قەڵای هەولێر | erbil | ✓ #1 | error | ✓ #1 |
| عنكاوا | erbil | ✓ #1 | error | ✗ (none) |
| Ankawa | erbil | ✓ #2 | error | ✓ #1 |
| Family Mall | erbil | ✓ #2 | error | ✓ #1 |
| فاميلي مول | erbil | ✗ (Al Mussayib family Mall) | error | ✓ #1 |
| Majidi Mall | erbil | ✓ #1 | error | ✓ #1 |
| منتزه سامي عبد الرحمن | erbil | ✗ (none) | error | ✗ (عبد الرحمن) |
| Sami Abdulrahman Park | erbil | ✓ #1 | error | ✓ #1 |
| جامعة صلاح الدين | erbil | ✗ (جامعة سامراء) | error | ✓ #5 |
| العشار | basra | ✓ #1 | error | ✓ #1 |
| جامعة البصرة | basra | ✓ #1 | error | ✓ #1 |
| كورنيش البصرة | basra | ✓ #1 | error | ✓ #1 |
| Basra International Airport | basra | ✓ #1 | error | ✓ #1 |
| البصره | basra | ✗ (محافظة البصرة) | error | ✓ #1 |
| جامعة الموصل | mosul | ✓ #1 | error | ✓ #1 |
| University of Mosul | mosul | ✓ #1 | error | ✓ #1 |
| الجامع النوري | mosul | ✗ (none) | ✗ (مركز النورين للتوحد وذوي ) | ✗ (الجامع النووي) |
| الدواسة | mosul | ✓ #1 | error | ✓ #1 |
| مرقد الإمام علي | najaf | ✗ (محافظة النجف) | error | ✓ #1 |
| Imam Ali Shrine | najaf | ✓ #1 | error | ✗ (Imam Ali Shrine) |
| جامعة الكوفة | najaf | ✓ #1 | error | ✓ #1 |
| مرقد الإمام الحسين | karbala | ✗ (Hay Al-Hussain) | error | ✓ #1 |
| Imam Husayn Shrine | karbala | ✓ #1 | error | ✓ #1 |
| جامعة كربلاء | karbala | ✓ #1 | error | ✓ #1 |
| پارکی ئازادی | sulaymaniyah | ✓ #1 | error | ✗ (none) |
| Azadi Park Sulaymaniyah | sulaymaniyah | ✓ #1 | error | ✓ #2 |
| شارع سالم | sulaymaniyah | ✓ #1 | error | ✓ #1 |
| زانکۆی سلێمانی | sulaymaniyah | ✓ #1 | error | ✓ #1 |
| جامعة السليمانية | sulaymaniyah | ✓ #1 | error | ✓ #1 |
| قلعة كركوك | kirkuk | ✓ #1 | error | ✓ #1 |
| Kirkuk Citadel | kirkuk | ✓ #1 | error | ✓ #1 |
| جامعة كركوك | kirkuk | ✓ #1 | error | ✓ #1 |
| سد دهوك | duhok | ✓ #1 | error | ✓ #1 |
| Duhok Dam | duhok | ✓ #1 | error | ✓ #1 |
| زانکۆی دهۆک | duhok | ✓ #1 | error | ✓ #1 |
| جامعة دهوك | duhok | ✓ #1 | error | ✓ #1 |


## Darbna's own search (what the app runs)

Hit = one of the top 5 results is in the right city (within 25 km). 53 queries.

| Provider | Hits | Errors |
|---|---|---|
| darbna | 51/53 (96%) | 0 |

By kind:

| Kind | darbna |
|---|---|
| neighbourhood (9) | 9 |
| variant (3) | 3 |
| typo (1) | 1 |
| street (3) | 3 |
| landmark (21) | 19 |
| school (12) | 12 |
| hospital (1) | 1 |
| business (3) | 3 |

By language:

| Language | darbna |
|---|---|
| ar (35) | 33 |
| ckb (4) | 4 |
| en (14) | 14 |

Every query:

| Query | City | darbna |
|---|---|---|
| الكرادة | baghdad | ✓ #1 |
| الكراده | baghdad | ✓ #1 |
| المنصور | baghdad | ✓ #1 |
| المنصوور | baghdad | ✓ #3 |
| الكاظمية | baghdad | ✓ #1 |
| زيونة | baghdad | ✓ #1 |
| شارع المتنبي | baghdad | ✓ #1 |
| شارع فلسطين | baghdad | ✓ #1 |
| ساحة التحرير | baghdad | ✓ #1 |
| مطار بغداد الدولي | baghdad | ✓ #1 |
| Baghdad International Airport | baghdad | ✓ #1 |
| جامعة بغداد | baghdad | ✓ #1 |
| مدينة الطب | baghdad | ✓ #1 |
| Al-Mansour | baghdad | ✓ #1 |
| قلعة أربيل | erbil | ✓ #1 |
| قلعة اربيل | erbil | ✓ #1 |
| Erbil Citadel | erbil | ✓ #1 |
| قەڵای هەولێر | erbil | ✓ #1 |
| عنكاوا | erbil | ✓ #1 |
| Ankawa | erbil | ✓ #2 |
| Family Mall | erbil | ✓ #2 |
| فاميلي مول | erbil | ✓ #2 |
| Majidi Mall | erbil | ✓ #1 |
| منتزه سامي عبد الرحمن | erbil | ✗ (عبد الرحمن) |
| Sami Abdulrahman Park | erbil | ✓ #1 |
| جامعة صلاح الدين | erbil | ✓ #4 |
| العشار | basra | ✓ #1 |
| جامعة البصرة | basra | ✓ #1 |
| كورنيش البصرة | basra | ✓ #1 |
| Basra International Airport | basra | ✓ #1 |
| البصره | basra | ✓ #1 |
| جامعة الموصل | mosul | ✓ #1 |
| University of Mosul | mosul | ✓ #1 |
| الجامع النوري | mosul | ✗ (الجامع النووي) |
| الدواسة | mosul | ✓ #1 |
| مرقد الإمام علي | najaf | ✓ #1 |
| Imam Ali Shrine | najaf | ✓ #1 |
| جامعة الكوفة | najaf | ✓ #1 |
| مرقد الإمام الحسين | karbala | ✓ #1 |
| Imam Husayn Shrine | karbala | ✓ #1 |
| جامعة كربلاء | karbala | ✓ #1 |
| پارکی ئازادی | sulaymaniyah | ✓ #1 |
| Azadi Park Sulaymaniyah | sulaymaniyah | ✓ #1 |
| شارع سالم | sulaymaniyah | ✓ #1 |
| زانکۆی سلێمانی | sulaymaniyah | ✓ #1 |
| جامعة السليمانية | sulaymaniyah | ✓ #1 |
| قلعة كركوك | kirkuk | ✓ #1 |
| Kirkuk Citadel | kirkuk | ✓ #1 |
| جامعة كركوك | kirkuk | ✓ #1 |
| سد دهوك | duhok | ✓ #1 |
| Duhok Dam | duhok | ✓ #1 |
| زانکۆی دهۆک | duhok | ✓ #1 |
| جامعة دهوك | duhok | ✓ #1 |

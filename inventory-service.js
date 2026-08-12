// 庫存資料存取層：讀寫 Firestore 的 stock collection。
// 一筆文件 = 一個品項在一個倉庫的庫存現況（品號 + 倉庫 唯一決定一筆）。

import { db } from './firebase-config.js?v=27';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const stockCol = collection(db, 'stock');

// Firestore 文件 ID 不能包含「/」，品號理論上不該有但保險起見還是處理掉
function sanitizeIdPart(s) {
  return (s || '').toString().replace(/\//g, '-');
}

function stockDocId(itemCode, warehouse) {
  return `${sanitizeIdPart(itemCode)}__${warehouse}`;
}

export function subscribeToStock(callback, onError) {
  return onSnapshot(
    stockCol,
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// 匯入用：整批覆蓋「這次匯入的倉庫」資料。
// records: [{ itemCode, itemName, warehouse, qty }]
// 批號是在畫面上跟 batchList collection 即時對出來的，不在匯入這步驟處理
// （庫存.xlsx 跟批號.xlsx 現在是分開匯入的兩個檔案，匯入當下沒辦法互相對照）。
// lockedQty/expired/remark/isSplit 這些欄位目前 ERP 原始匯出檔沒有對應資料，先留著欄位、預設空值，
// 之後如果拿到鎖庫/參照這些資料來源再回頭補上。
// 同一個倉庫舊資料會被完全取代（品項下架/歸零時，舊的庫存文件也要跟著消失，不能只靠覆蓋殘留）。
export async function replaceStockForWarehouses(records, warehouses) {
  // 1. 先刪掉這些倉庫目前在 Firestore 裡的所有舊資料
  const existingSnap = await getDocs(stockCol);
  const toDelete = existingSnap.docs.filter(d => warehouses.includes(d.data().warehouse));

  const chunks = [];
  const all = [...toDelete];
  while (all.length) chunks.push(all.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. 寫入新資料
  const recordChunks = [];
  const remaining = [...records];
  while (remaining.length) recordChunks.push(remaining.splice(0, 450));
  for (const chunk of recordChunks) {
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(db, 'stock', stockDocId(r.itemCode, r.warehouse));
      batch.set(ref, {
        itemCode: r.itemCode,
        itemName: r.itemName,
        warehouse: r.warehouse,
        warehouseLocation: r.warehouseLocation || '',
        qty: r.qty || 0,
        nearestExpiry: r.nearestExpiry || null,
        note: r.note || '',
        lockedQty: r.lockedQty || 0,
        qtyBeforeLock: r.qtyBeforeLock ?? null,
        expired: r.expired || '',
        remark: r.remark || '',
        hiddenFromTaishanManager: !!r.hiddenFromTaishanManager,
        isSplit: !!r.isSplit,
        batches: r.batches || [],
        updatedAt: Date.now()
      });
    });
    await batch.commit();
  }

  return { deleted: toDelete.length, written: records.length };
}

export async function updateStockNote(itemCode, warehouse, note) {
  const ref = doc(db, 'stock', stockDocId(itemCode, warehouse));
  await setDoc(ref, { note }, { merge: true });
}

// ---------- 共用：整批覆蓋一個 collection（可用 filterFn 只覆蓋其中一部分） ----------

// filterFn 不給的話就是整個 collection 全部覆蓋；有給的話只刪掉 filterFn(doc)===true 的部分
// （例如未核完調整分好幾個來源檔案各自匯入，不能匯入銷貨就把異動的資料也洗掉）
async function replaceWholeCollection(collectionName, docs, filterFn) {
  const col = collection(db, collectionName);
  const existingSnap = await getDocs(col);

  const toDeleteSource = filterFn ? existingSnap.docs.filter(d => filterFn(d.data())) : [...existingSnap.docs];
  const deletedCount = toDeleteSource.length;
  const deleteChunks = [];
  const toDelete = [...toDeleteSource];
  while (toDelete.length) deleteChunks.push(toDelete.splice(0, 450));
  for (const chunk of deleteChunks) {
    const batch = writeBatch(db);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  const writeChunks = [];
  const remaining = [...docs];
  while (remaining.length) writeChunks.push(remaining.splice(0, 450));
  for (const chunk of writeChunks) {
    const batch = writeBatch(db);
    chunk.forEach(({ id, data }) => batch.set(doc(db, collectionName, id), data));
    await batch.commit();
  }

  return { deleted: deletedCount, written: docs.length };
}

function subscribeToCollection(collectionName, callback, onError) {
  return onSnapshot(
    collection(db, collectionName),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export function subscribeToFactoryMaterial(callback, onError) {
  return subscribeToCollection('factoryMaterial', callback, onError);
}

// records: [{ itemCode, itemName, qty }] — 批號、最短效期是在畫面上跟 batchList（廠務）即時對出來的，不存在這裡
export async function replaceFactoryMaterial(records) {
  const docs = records.map(r => ({
    id: sanitizeIdPart(r.itemCode),
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      qty: r.qty || 0,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('factoryMaterial', docs);
}

// ---------- 品項參照主檔（品名/產地/單位/採購/類別/大類/淨重/毛重/公司別/標記/散裝/註記）：
// ERP 沒有這份資料，是人工維護的品項主檔，逐欄位編輯；也可以從組合檔的「參照(新)」分頁批次匯入當初始值 ----------

export function subscribeToItemReference(callback, onError) {
  return subscribeToCollection('itemReference', callback, onError);
}

// 表格裡單一欄位編輯，改一欄存一欄，不影響其他欄位
export async function setItemReferenceField(itemCode, field, value) {
  const ref = doc(db, 'itemReference', sanitizeIdPart(itemCode));
  await setDoc(ref, { itemCode, [field]: value, updatedAt: Date.now() }, { merge: true });
}

// 組合檔「參照(新)」分頁可以整批匯入當初始值：只 set/merge，不刪除，
// 這樣才不會把使用者之後手動改過的其他品項資料洗掉（跟其他 collection 的整批覆蓋不一樣）。
// records: [{ itemCode, itemName, origin, unit, purchaseType, category, majorCategory,
//             netWeight, grossWeight, companyType, tag, isSplit, note }]
export async function importItemReferenceFromMaster(records) {
  const chunks = [];
  const remaining = [...records];
  while (remaining.length) chunks.push(remaining.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(db, 'itemReference', sanitizeIdPart(r.itemCode));
      batch.set(ref, { ...r, updatedAt: Date.now() }, { merge: true });
    });
    await batch.commit();
  }
  return { written: records.length };
}

// ---------- 批號：每次匯入完全覆蓋 ----------

export function subscribeToBatchList(callback, onError) {
  return subscribeToCollection('batchList', callback, onError);
}

// records: [{ itemCode, itemName, warehouse, batchNo, qty }]
export async function replaceBatchList(records) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${r.warehouse}__${sanitizeIdPart(r.batchNo) || 'nobatch'}__${i}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      warehouse: r.warehouse,
      batchNo: r.batchNo || '',
      qty: r.qty || 0,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('batchList', docs);
}

// ---------- 寄庫：每次匯入完全覆蓋 ----------

export function subscribeToConsignment(callback, onError) {
  return subscribeToCollection('consignment', callback, onError);
}

// records: [{ itemCode, itemName, customer, qty }]
export async function replaceConsignment(records) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${sanitizeIdPart(r.customer)}__${i}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      customer: r.customer,
      qty: r.qty || 0,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('consignment', docs);
}

// ---------- 寄庫的倉庫分配：ERP的寄庫數量是客戶+品項的總數，沒有泰山/台中的細分。
// 對照過0805庫存YU的「寄庫」分頁，真實的做法是逐日記錄進出（一欄一天，正數=當天寄入、負數=當天出庫），
// 目前數量是全部加總、寄庫日期是最近一筆的日期——這裡改成資料庫版本：每筆進出各自一筆帶日期的紀錄，
// 不是一欄一天，畫面上即時加總算出目前數量跟最近日期。同一個客戶+品項+倉庫可以有很多筆，逐筆新增/刪除。

export function subscribeToConsignmentLedger(callback, onError) {
  return subscribeToCollection('consignmentLedger', callback, onError);
}

// entry: { customer, itemCode, itemName, warehouse, date('YYYY-MM-DD'), deltaQty(正=寄入/負=出庫), remark }
export async function addConsignmentLedgerEntry(entry) {
  await addDoc(collection(db, 'consignmentLedger'), { ...entry, updatedAt: Date.now() });
}

export async function deleteConsignmentLedgerEntry(id) {
  await deleteDoc(doc(db, 'consignmentLedger', id));
}

// 從組合檔「寄庫」分頁批次匯入歷史進出紀錄（該分頁一欄一天，這裡已經在 app.js 解析成一筆一筆帶日期的紀錄）。
// 用「客戶+品號+倉庫+日期」當文件ID（不是隨機ID）：同一天在原始表格裡本來就只有一個數字，
// 用日期當ID可以讓同一份檔案重複匯入時是覆蓋、不是產生重複資料。跟畫面上手動新增的單筆紀錄
// （用隨機ID，允許同一天有好幾筆）是不同的ID規則，兩種紀錄會共存在同一個 collection 裡。
function consignmentLedgerImportDocId(customer, itemCode, warehouse, date) {
  return `${sanitizeIdPart(customer)}__${sanitizeIdPart(itemCode)}__${warehouse}__${date}`;
}

export async function importConsignmentLedgerEntries(records) {
  const chunks = [];
  const remaining = [...records];
  while (remaining.length) chunks.push(remaining.splice(0, 450));
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach(r => {
      const ref = doc(db, 'consignmentLedger', consignmentLedgerImportDocId(r.customer, r.itemCode, r.warehouse, r.date));
      batch.set(ref, { ...r, updatedAt: Date.now() }, { merge: true });
    });
    await batch.commit();
  }
  return { written: records.length };
}

// ---------- 未核完調整（銷貨/銷退/進貨/退貨/組合/異動/調撥）：每次匯入完全覆蓋 ----------
// 泰山/台中庫存數字只反映「已核完」的單據，這裡存的是還沒核完、需要另外加減回庫存數字的部分。

export function subscribeToPendingAdjustments(callback, onError) {
  return subscribeToCollection('pendingAdjustments', callback, onError);
}

// records: [{ itemCode, warehouse, deltaQty, source }]
// sources：這次匯入來源涵蓋哪幾種（例如匯入「銷貨」時傳 ['銷貨']），只會覆蓋這些來源舊資料，
// 不會動到其他來源檔案（異動/轉撥/...）之前匯入的部分——因為現在每種都是分開的檔案各自匯入。
export async function replacePendingAdjustments(records, sources) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${r.warehouse}__${sanitizeIdPart(r.source)}__${i}`,
    data: {
      itemCode: r.itemCode,
      warehouse: r.warehouse,
      deltaQty: r.deltaQty || 0,
      source: r.source || '',
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('pendingAdjustments', docs, data => sources.includes(data.source));
}

// ---------- 彙總（會計角色用）：每次匯入完全覆蓋 ----------

export function subscribeToSummary(callback, onError) {
  return subscribeToCollection('summary', callback, onError);
}

// records: [{ itemCode, itemName, taishanQty, taichungQty, totalQty, unitWeight, totalWeight,
//             purchaseType, category, majorCategory, origin, vendors: [{ label, qty, weight }] }]
export async function replaceSummary(records) {
  const docs = records.map(r => ({
    id: sanitizeIdPart(r.itemCode),
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      taishanQty: r.taishanQty || 0,
      taichungQty: r.taichungQty || 0,
      totalQty: r.totalQty || 0,
      unitWeight: r.unitWeight || 0,
      totalWeight: r.totalWeight || 0,
      purchaseType: r.purchaseType || '',
      category: r.category || '',
      majorCategory: r.majorCategory || '',
      origin: r.origin || '',
      vendors: r.vendors || [],
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('summary', docs);
}

// ---------- 鎖庫：ERP 沒有這份資料，是老闆口頭決定要鎖起來的品項，人工維護 ----------
// 同一個品項可以同時有好幾筆鎖庫紀錄（例如同一品項一部分鎖給不同客戶/廠務），
// 所以不是「品號+倉庫」對一筆，而是每筆自己一個文件（用 Firestore 自動 ID），
// 可以隨時新增/編輯/刪除單一筆，不是整批匯入覆蓋。

export function subscribeToLockedStock(callback, onError) {
  return subscribeToCollection('lockedStock', callback, onError);
}

// record: { itemCode, itemName, warehouse, tag, lockedQty, remark }
// warehouse：泰山或台中，決定這筆鎖庫算在哪個倉庫的庫存標籤上
// tag：對應組合檔「鎖庫」分頁的「庫別名稱」細分——客戶名字、"廠務鎖庫"，或留空代表就是倉庫本身的貨
export async function addLockedStock(record) {
  await addDoc(collection(db, 'lockedStock'), { ...record, updatedAt: Date.now() });
}

export async function updateLockedStock(id, record) {
  await setDoc(doc(db, 'lockedStock', id), { ...record, updatedAt: Date.now() }, { merge: true });
}

export async function deleteLockedStock(id) {
  await deleteDoc(doc(db, 'lockedStock', id));
}

// ---------- 每日快照：手動存檔「今天最終版本」，之後可以按日期回頭查 ----------
// 每天匯入的資料（庫存/批號/寄庫/廠務用料/未核完調整）都是整批覆蓋，舊的一天過去就消失了。
// 使用者要留存「當天最終結果」的歷史記錄，用「今天完成」按鈕手動存檔（不是每次匯入自動存，
// 因為當天可能匯入好幾次還沒定案）。一個日期一種資料類型各自一份文件，避免單一文件塞太多資料。

const SNAPSHOT_TYPES = ['stock', 'batchList', 'consignment', 'factoryMaterial', 'pendingAdjustments', 'lockedStock', 'consignmentLedger'];

function snapshotDocId(date, type) {
  return `${date}__${type}`;
}

// date: 'YYYY-MM-DD'；data: { stock, batchList, consignment, factoryMaterial, pendingAdjustments, lockedStock, consignmentLedger }（畫面上目前訂閱到的即時資料）
export async function saveDailySnapshot(date, data) {
  const batch = writeBatch(db);
  SNAPSHOT_TYPES.forEach(type => {
    const ref = doc(db, 'dailySnapshots', snapshotDocId(date, type));
    batch.set(ref, { date, type, records: data[type] || [], savedAt: Date.now() });
  });
  await batch.commit();
}

// 回傳 { stock, batchList, consignment, factoryMaterial, pendingAdjustments }，
// 某個類型那天沒存過快照就是 null（跟「有存但是空陣列」分開，畫面上可以分辨兩種情況）
export async function loadDailySnapshot(date) {
  const result = {};
  for (const type of SNAPSHOT_TYPES) {
    const snap = await getDoc(doc(db, 'dailySnapshots', snapshotDocId(date, type)));
    result[type] = snap.exists() ? (snap.data().records || []) : null;
  }
  return result;
}

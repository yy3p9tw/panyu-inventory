// 庫存資料存取層：讀寫 Firestore 的 stock collection。
// 一筆文件 = 一個品項在一個倉庫的庫存現況（品號 + 倉庫 唯一決定一筆）。

import { db } from './firebase-config.js?v=1';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
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

// ---------- 品項標記（原料/成品/半成品...）：ERP 沒有這份資料，人工維護，逐筆編輯不是整批匯入 ----------

export function subscribeToItemTags(callback, onError) {
  return subscribeToCollection('itemTags', callback, onError);
}

export async function setItemTag(itemCode, tag) {
  const ref = doc(db, 'itemTags', sanitizeIdPart(itemCode));
  await setDoc(ref, { itemCode, tag, updatedAt: Date.now() }, { merge: true });
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

// ---------- 原始匯入（整份組合檔，不管欄位意義，每個分頁每一列原樣存起來）：每次匯入完全覆蓋 ----------

export function subscribeToRawImport(callback, onError) {
  return subscribeToCollection('rawImport', callback, onError);
}

// records: [{ sheet, sheetOrder, rowIndex, cells: [...] }]
export async function replaceRawImport(records) {
  const docs = records.map(r => ({
    id: `${sanitizeIdPart(r.sheet)}__${r.rowIndex}`,
    data: {
      sheet: r.sheet,
      sheetOrder: r.sheetOrder,
      rowIndex: r.rowIndex,
      cells: r.cells,
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('rawImport', docs);
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

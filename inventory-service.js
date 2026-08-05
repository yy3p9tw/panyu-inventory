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
// records: [{ itemCode, itemName, warehouse, warehouseLocation, qty, nearestExpiry, note,
//             lockedQty, qtyBeforeLock, expired, remark, hiddenFromTaishanManager, isSplit,
//             batches: [{ batchNo, qty }] }]  // batches 目前只有台中有資料（從批號分頁對出來的）
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

// ---------- 廠務用料 / 可用原料（泰山）：整份分頁每次匯入完全覆蓋 ----------

async function replaceWholeCollection(collectionName, docs) {
  const col = collection(db, collectionName);
  const existingSnap = await getDocs(col);

  const deleteChunks = [];
  const toDelete = [...existingSnap.docs];
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

  return { deleted: existingSnap.docs.length, written: docs.length };
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

// records: [{ itemCode, itemName, qty, batchNo }] — 一個品號如果對到多個批號會拆成多列
export async function replaceFactoryMaterial(records) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.itemCode)}__${sanitizeIdPart(r.batchNo) || 'nobatch'}__${i}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      qty: r.qty || 0,
      batchNo: r.batchNo || '',
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('factoryMaterial', docs);
}

export function subscribeToAvailableMaterial(callback, onError) {
  return subscribeToCollection('availableMaterial', callback, onError);
}

// records: [{ itemCode, itemName, qty, batchNo, expired, tag }]
export async function replaceAvailableMaterial(records) {
  const docs = records.map(r => ({
    id: `${sanitizeIdPart(r.itemCode)}__${sanitizeIdPart(r.batchNo) || 'nobatch'}`,
    data: {
      itemCode: r.itemCode,
      itemName: r.itemName,
      qty: r.qty || 0,
      batchNo: r.batchNo || '',
      expired: r.expired || '',
      tag: r.tag || '',
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('availableMaterial', docs);
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

// records: [{ customer, itemName, warehouse, qty, consignmentDate }]
export async function replaceConsignment(records) {
  const docs = records.map((r, i) => ({
    id: `${sanitizeIdPart(r.customer)}__${sanitizeIdPart(r.itemName)}__${r.warehouse}__${i}`,
    data: {
      customer: r.customer,
      itemName: r.itemName,
      warehouse: r.warehouse,
      qty: r.qty || 0,
      consignmentDate: r.consignmentDate || '',
      updatedAt: Date.now()
    }
  }));
  return replaceWholeCollection('consignment', docs);
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

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPageAnnotations,
  savePageAnnotations,
  makePageAnnotationKey,
  StoredAnnotationItem,
} from '@/app/utils/db';

interface UndoEntry {
  pageNum: number;
  item: StoredAnnotationItem;
  action: 'add' | 'remove';
}

export function useAnnotations(bookId: string | null, pageNums: number[]) {
  const [itemsByPage, setItemsByPage] = useState<Record<number, StoredAnnotationItem[]>>({});
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  const pageNumsKey = pageNums.join(',');

  // Loaded fresh whenever the visible pages change (navigating to a
  // different section) -- undo/redo history is session-only, same idea as
  // everywhere else transient state resets per section in this app.
  useEffect(() => {
    if (!bookId || pageNums.length === 0) {
      setItemsByPage({});
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoCount(0);
      setRedoCount(0);
      return;
    }

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        pageNums.map(async (pageNum) => {
          const stored = await getPageAnnotations(bookId, pageNum);
          return [pageNum, stored?.items ?? []] as const;
        })
      );
      if (cancelled) return;
      const map: Record<number, StoredAnnotationItem[]> = {};
      for (const [pageNum, items] of entries) {
        map[pageNum] = items;
      }
      setItemsByPage(map);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoCount(0);
      setRedoCount(0);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, pageNumsKey]);

  const persistPage = useCallback(
    (pageNum: number, items: StoredAnnotationItem[]) => {
      if (!bookId) return;
      savePageAnnotations({
        pageKey: makePageAnnotationKey(bookId, pageNum),
        bookId,
        pageNum,
        items,
      });
    },
    [bookId]
  );

  const addItem = useCallback(
    (pageNum: number, item: StoredAnnotationItem) => {
      setItemsByPage((prev) => {
        const nextItems = [...(prev[pageNum] ?? []), item];
        persistPage(pageNum, nextItems);
        return { ...prev, [pageNum]: nextItems };
      });
      undoStackRef.current = [...undoStackRef.current, { pageNum, item, action: 'add' }];
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
    },
    [persistPage]
  );

  const removeItem = useCallback(
    (pageNum: number, item: StoredAnnotationItem) => {
      setItemsByPage((prev) => {
        const nextItems = (prev[pageNum] ?? []).filter((i) => i.id !== item.id);
        persistPage(pageNum, nextItems);
        return { ...prev, [pageNum]: nextItems };
      });
      undoStackRef.current = [...undoStackRef.current, { pageNum, item, action: 'remove' }];
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
    },
    [persistPage]
  );

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, last];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);

    setItemsByPage((prev) => {
      const current = prev[last.pageNum] ?? [];
      const nextItems =
        last.action === 'add'
          ? current.filter((i) => i.id !== last.item.id)
          : [...current, last.item];
      persistPage(last.pageNum, nextItems);
      return { ...prev, [last.pageNum]: nextItems };
    });
  }, [persistPage]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, last];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);

    setItemsByPage((prev) => {
      const current = prev[last.pageNum] ?? [];
      const nextItems =
        last.action === 'add'
          ? [...current, last.item]
          : current.filter((i) => i.id !== last.item.id);
      persistPage(last.pageNum, nextItems);
      return { ...prev, [last.pageNum]: nextItems };
    });
  }, [persistPage]);

  return {
    itemsByPage,
    addItem,
    removeItem,
    undo,
    redo,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
  };
}
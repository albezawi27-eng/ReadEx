'use client';

import React, { useRef, useState } from 'react';
import { StoredAnnotationItem } from '@/app/utils/db';

interface AnnotationLayerProps {
  items: StoredAnnotationItem[];
  nativeWidth: number;
  nativeHeight: number;
  pageYOffset: number;
  tool: 'pen' | 'eraser' | 'text';
  color: string;
  strokeWidth: number;
  isActive: boolean;
  onAddItem: (item: StoredAnnotationItem) => void;
  onRemoveItem: (item: StoredAnnotationItem) => void;
}

const ERASE_THRESHOLD_FRACTION = 0.02;

function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (const p of rest) {
    d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return d;
}

export default function AnnotationLayer({
  items,
  nativeWidth,
  nativeHeight,
  pageYOffset,
  tool,
  color,
  strokeWidth,
  isActive,
  onAddItem,
  onRemoveItem,
}: AnnotationLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDrawingRef = useRef(false);
  const currentPointsRef = useRef<{ x: number; y: number }[]>([]);
  const erasedThisGestureRef = useRef<Set<string>>(new Set());
  const [livePoints, setLivePoints] = useState<{ x: number; y: number }[]>([]);
  const [editingText, setEditingText] = useState<{ x: number; y: number; value: string } | null>(null);

  const eraseThreshold = nativeWidth * ERASE_THRESHOLD_FRACTION;

  // Points are full-page-relative (y=0 at the actual top of the PDF page),
  // not crop-relative -- pageYOffset shifts the SVG's viewBox to show just
  // this crop's slice of that page-sized coordinate space.
  const getViewBoxPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const fracX = (clientX - rect.left) / rect.width;
    const fracY = (clientY - rect.top) / rect.height;
    return { x: fracX * nativeWidth, y: pageYOffset + fracY * nativeHeight };
  };

  const eraseNear = (point: { x: number; y: number }) => {
    for (const item of items) {
      if (item.type !== 'stroke') continue;
      if (erasedThisGestureRef.current.has(item.id)) continue;
      const near = item.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < eraseThreshold);
      if (near) {
        erasedThisGestureRef.current.add(item.id);
        onRemoveItem(item);
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isActive) return;

    if (tool === 'text') {
      const point = getViewBoxPoint(e.clientX, e.clientY);
      setEditingText({ x: point.x, y: point.y, value: '' });
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const point = getViewBoxPoint(e.clientX, e.clientY);

    if (tool === 'pen') {
      isDrawingRef.current = true;
      currentPointsRef.current = [point];
      setLivePoints([point]);
    } else if (tool === 'eraser') {
      isDrawingRef.current = true;
      erasedThisGestureRef.current = new Set();
      eraseNear(point);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isActive || !isDrawingRef.current) return;
    const point = getViewBoxPoint(e.clientX, e.clientY);

    if (tool === 'pen') {
      currentPointsRef.current = [...currentPointsRef.current, point];
      setLivePoints(currentPointsRef.current);
    } else if (tool === 'eraser') {
      eraseNear(point);
    }
  };

  const handlePointerUp = () => {
    if (!isActive) return;

    if (tool === 'pen' && isDrawingRef.current) {
      const points = currentPointsRef.current;
      if (points.length > 1) {
        onAddItem({
          id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'stroke',
          points,
          color,
          width: strokeWidth,
        });
      }
      currentPointsRef.current = [];
      setLivePoints([]);
    }

    isDrawingRef.current = false;
    erasedThisGestureRef.current = new Set();
  };

  const commitText = () => {
    if (editingText && editingText.value.trim()) {
      onAddItem({
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'text',
        x: editingText.x,
        y: editingText.y,
        text: editingText.value.trim(),
        color,
        fontSize: Math.max(16, nativeWidth * 0.025),
      });
    }
    setEditingText(null);
  };

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: isActive ? 'auto' : 'none', touchAction: isActive ? 'none' : undefined }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 ${pageYOffset} ${nativeWidth} ${nativeHeight}`}
        className="w-full h-full"
        style={{ cursor: isActive ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {items.map((item) =>
          item.type === 'stroke' ? (
            <path
              key={item.id}
              d={pointsToPath(item.points)}
              stroke={item.color}
              strokeWidth={item.width}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <text
              key={item.id}
              x={item.x}
              y={item.y}
              fill={item.color}
              fontSize={item.fontSize}
              dominantBaseline="hanging"
              style={{ fontFamily: 'sans-serif' }}
            >
              {item.text}
            </text>
          )
        )}
        {livePoints.length > 1 && (
          <path
            d={pointsToPath(livePoints)}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )}
      </svg>

      {editingText && (
        <textarea
          autoFocus
          value={editingText.value}
          onChange={(e) => setEditingText({ ...editingText, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitText();
            } else if (e.key === 'Escape') {
              setEditingText(null);
            }
          }}
          style={{
            position: 'absolute',
            left: `${(editingText.x / nativeWidth) * 100}%`,
            top: `${((editingText.y - pageYOffset) / nativeHeight) * 100}%`,
            color,
            fontSize: '14px',
            minWidth: '120px',
            minHeight: '28px',
            background: 'rgba(255,255,255,0.95)',
            border: '1px dashed currentColor',
            borderRadius: '4px',
            padding: '2px 4px',
            resize: 'both',
          }}
        />
      )}
    </div>
  );
}
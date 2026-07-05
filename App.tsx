import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DialRoot, useDialKitController } from 'dialkit';
import CalligraphyCanvas from './components/CalligraphyCanvas';
import { ExportModal } from './components/ExportModal';
import { INITIAL_CONFIG, PenConfig, DrawingTool } from './types';

function App() {
  const [clearTrigger, setClearTrigger] = useState(false);
  const [downloadTrigger, setDownloadTrigger] = useState(false);
  const [downloadSvgTrigger, setDownloadSvgTrigger] = useState(false);
  const [copySvgTrigger, setCopySvgTrigger] = useState(false);
  const [undoTrigger, setUndoTrigger] = useState(false);
  const [redoTrigger, setRedoTrigger] = useState(false);
  const [deleteTrigger, setDeleteTrigger] = useState(false);
  const [finishPathTrigger, setFinishPathTrigger] = useState(false);
  const [shapePreviewTrigger, setShapePreviewTrigger] = useState<{ simplify: number; smooth: number } | null>(null);
  const [shapeCommitTrigger, setShapeCommitTrigger] = useState(false);
  const [toggleClosedTrigger, setToggleClosedTrigger] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(prev => prev?.message === message ? null : prev);
    }, 3500);
  };

  // The whole tool sidebar lives in DialKit now: tool switching, pen params,
  // canvas/ink color, and the context actions (undo/redo/clear/export/edit).
  const dial = useDialKitController('Calligraphy Studio', {
    undo: { type: 'action' as const, label: 'Undo' },
    redo: { type: 'action' as const, label: 'Redo' },
    clear: { type: 'action' as const, label: 'Clear Canvas' },
    exportArt: { type: 'action' as const, label: 'Export...' },

    tool: {
      type: 'select' as const,
      options: [
        { value: 'brush', label: 'Brush (B)' },
        { value: 'bezier', label: 'Bezier Pen (P)' },
        { value: 'select', label: 'Edit (A)' },
        { value: 'move', label: 'Move (M)' },
      ],
      default: 'brush',
    },
    width: [40, 5, 120, 1] as [number, number, number, number],
    cap: { type: 'select' as const, options: ['round', 'square'], default: 'round' },
    ink: { type: 'color' as const, default: '#D79B77' },
    canvasBg: {
      type: 'select' as const,
      options: [
        { value: '#FFFBF1', label: 'Warm Cream' },
        { value: '#232049', label: 'Deep Purple-Blue' },
        { value: '#0E5642', label: 'Deep Forest Green' },
        { value: 'transparent', label: 'Transparent' },
      ],
      default: '#FFFBF1',
    },

    edit: {
      simplify: [0, 0, 50, 1] as [number, number, number, number],
      smooth: [0, 0, 100, 1] as [number, number, number, number],
      finishPath: { type: 'action' as const, label: 'Complete Bezier Path' },
      toggleClosed: { type: 'action' as const, label: 'Toggle Loop' },
      deleteSelected: { type: 'action' as const, label: 'Delete Selected' },
    },
  }, {
    onAction: (path) => {
      switch (path) {
        case 'undo': setUndoTrigger(true); break;
        case 'redo': setRedoTrigger(true); break;
        case 'clear': setClearTrigger(true); break;
        case 'exportArt': setIsExportModalOpen(true); break;
        case 'edit.finishPath': setFinishPathTrigger(true); break;
        case 'edit.toggleClosed': setToggleClosedTrigger(true); break;
        case 'edit.deleteSelected': setDeleteTrigger(true); break;
      }
    },
  });

  const config: PenConfig = {
    ...INITIAL_CONFIG,
    tool: dial.values.tool as DrawingTool,
    width: dial.values.width,
    cap: dial.values.cap as 'round' | 'square',
    color: dial.values.ink,
    bgColor: dial.values.canvasBg,
  };

  // Debounce Simplify + Smooth into a single undo step: DialKit reports every slider
  // tick live, so preview immediately but only commit history once things settle.
  // Both sliders always recompute together (simplify, then smooth, from the stroke's
  // untouched original points) so using one never clobbers the other's effect, and
  // dragging either back to 0 always gets you back the exact original shape.
  const simplifyAmount = dial.values.edit.simplify;
  const smoothAmount = dial.values.edit.smooth;

  // Set right before dial.setValues() below syncs the sliders to a newly selected
  // stroke's own remembered amounts, so that programmatic sync doesn't get mistaken
  // for a user drag and re-preview/re-save history for a shape that hasn't changed.
  const skipNextShapeSyncRef = useRef(false);

  useEffect(() => {
    if (skipNextShapeSyncRef.current) {
      skipNextShapeSyncRef.current = false;
      return;
    }
    setShapePreviewTrigger({ simplify: simplifyAmount, smooth: smoothAmount });
    const t = setTimeout(() => setShapeCommitTrigger(true), 400);
    return () => clearTimeout(t);
  }, [simplifyAmount, smoothAmount]);

  // Keyboard shortcuts handler for premium professional workflow
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        // Allow shortcuts if it's only a slider/range input, but block if typing in a text field
        if ((activeEl as HTMLInputElement).type !== 'range') {
          return;
        }
      }

      const key = e.key.toLowerCase();

      // Ctrl+Z / Cmd+Z (Undo)
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        setUndoTrigger(true);
      }
      // Ctrl+Y / Cmd+Y (Redo)
      else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        setRedoTrigger(true);
      }
      // Ctrl+A / Cmd+A — block the browser's native "select all page text"
      else if ((e.ctrlKey || e.metaKey) && key === 'a') {
        e.preventDefault();
      }
      // Delete or Backspace to delete selected stroke
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (dial.values.tool === 'select') {
          e.preventDefault();
          setDeleteTrigger(true);
        }
      }
      // P for Pen (Bezier)
      else if (key === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dial.setValue('tool', 'bezier');
      }
      // B for Brush
      else if (key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dial.setValue('tool', 'brush');
      }
      // A for Select / Edit (Direct Select)
      else if (key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dial.setValue('tool', 'select');
      }
      // M for Move / Pan (Hand tool)
      else if (key === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        dial.setValue('tool', 'move');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dial.values.tool]);

  const handleClear = () => setClearTrigger(true);
  const handleDownload = () => setDownloadTrigger(true);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-stone-100 animate-fade-in">
      {/* Toast Notification overlay */}
      <AnimatePresence>
        {notification && (
          <motion.div
            id="toast-notification"
            initial={{ opacity: 0, y: -20, x: "-50%", scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
            exit={{ opacity: 0, y: -20, x: "-50%", scale: 0.95 }}
            className={`absolute top-6 left-1/2 px-5 py-3 rounded-xl border text-xs font-medium z-50 flex items-center gap-2.5 backdrop-blur-md ${
              notification.type === 'success'
                ? 'bg-stone-900/95 border-stone-800 text-white'
                : 'bg-red-950/95 border-red-900/50 text-red-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${notification.type === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>

      <CalligraphyCanvas
        config={config}
        clearTrigger={clearTrigger}
        setClearTrigger={setClearTrigger}
        downloadTrigger={downloadTrigger}
        setDownloadTrigger={setDownloadTrigger}
        downloadSvgTrigger={downloadSvgTrigger}
        setDownloadSvgTrigger={setDownloadSvgTrigger}
        copySvgTrigger={copySvgTrigger}
        setCopySvgTrigger={setCopySvgTrigger}
        onShowNotification={showNotification}
        undoTrigger={undoTrigger}
        setUndoTrigger={setUndoTrigger}
        redoTrigger={redoTrigger}
        setRedoTrigger={setRedoTrigger}
        deleteTrigger={deleteTrigger}
        setDeleteTrigger={setDeleteTrigger}
        finishPathTrigger={finishPathTrigger}
        setFinishPathTrigger={setFinishPathTrigger}
        shapePreviewTrigger={shapePreviewTrigger}
        setShapePreviewTrigger={setShapePreviewTrigger}
        shapeCommitTrigger={shapeCommitTrigger}
        setShapeCommitTrigger={setShapeCommitTrigger}
        toggleClosedTrigger={toggleClosedTrigger}
        setToggleClosedTrigger={setToggleClosedTrigger}
        onSelectedShapeParamsChange={(params) => {
          skipNextShapeSyncRef.current = true;
          dial.setValues({
            edit: {
              simplify: params ? params.simplify : 0,
              smooth: params ? params.smooth : 0,
            },
          });
        }}
      />

      <div className="absolute top-6 left-6 w-80 max-h-[90vh] rounded-2xl overflow-hidden shadow-xl z-10">
        <DialRoot mode="inline" productionEnabled />
      </div>

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onDownloadPng={handleDownload}
        onDownloadSvg={() => setDownloadSvgTrigger(true)}
        onCopySvg={() => setCopySvgTrigger(true)}
      />

      <div className="absolute bottom-4 right-6 text-stone-400 text-xs select-none pointer-events-none z-10 font-mono">
        Vector Spline Canvas • 60 FPS
      </div>
    </div>
  );
}

export default App;

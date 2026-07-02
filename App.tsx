import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import CalligraphyCanvas from './components/CalligraphyCanvas';
import Controls from './components/Controls';
import { ExportModal } from './components/ExportModal';
import { LayersPanel } from './components/LayersPanel';
import { INITIAL_CONFIG, PenConfig, VectorStroke } from './types';

function App() {
  const [config, setConfig] = useState<PenConfig>(INITIAL_CONFIG);
  const [clearTrigger, setClearTrigger] = useState(false);
  const [downloadTrigger, setDownloadTrigger] = useState(false);
  const [downloadSvgTrigger, setDownloadSvgTrigger] = useState(false);
  const [copySvgTrigger, setCopySvgTrigger] = useState(false);
  const [undoTrigger, setUndoTrigger] = useState(false);
  const [redoTrigger, setRedoTrigger] = useState(false);
  const [deleteTrigger, setDeleteTrigger] = useState(false);
  const [finishPathTrigger, setFinishPathTrigger] = useState(false);
  const [smoothTrigger, setSmoothTrigger] = useState(false);
  const [toggleClosedTrigger, setToggleClosedTrigger] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [strokes, setStrokes] = useState<VectorStroke[]>([]);
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null);
  const [layerActionTrigger, setLayerActionTrigger] = useState<{
    type: 'select' | 'delete' | 'toggleVisibility' | 'toggleLock' | 'rename' | 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack';
    strokeId: string;
    value?: any;
  } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(prev => prev?.message === message ? null : prev);
    }, 3500);
  };

  // Keyboard shortcuts handler for premium professional workflow
  React.useEffect(() => {
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
      // Delete or Backspace to delete selected stroke
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (config.tool === 'select') {
          e.preventDefault();
          setDeleteTrigger(true);
        }
      }
      // P for Pen (Bezier)
      else if (key === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setConfig(prev => ({ ...prev, tool: 'bezier' }));
      }
      // B for Brush
      else if (key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setConfig(prev => ({ ...prev, tool: 'brush' }));
      }
      // A for Select / Edit (Direct Select)
      else if (key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setConfig(prev => ({ ...prev, tool: 'select' }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config.tool]);

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
        smoothTrigger={smoothTrigger}
        setSmoothTrigger={setSmoothTrigger}
        toggleClosedTrigger={toggleClosedTrigger}
        setToggleClosedTrigger={setToggleClosedTrigger}
        onStrokesChange={setStrokes}
        onSelectedStrokeIdChange={setSelectedStrokeId}
        layerActionTrigger={layerActionTrigger}
        setLayerActionTrigger={setLayerActionTrigger}
      />
      
      <Controls 
        config={config} 
        setConfig={setConfig} 
        onClear={handleClear}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onUndo={() => setUndoTrigger(true)}
        onRedo={() => setRedoTrigger(true)}
        onDeleteSelected={() => setDeleteTrigger(true)}
        onFinishPath={() => setFinishPathTrigger(true)}
        onSmoothSelected={() => setSmoothTrigger(true)}
        onToggleClosedSelected={() => setToggleClosedTrigger(true)}
      />

      <LayersPanel 
        strokes={strokes}
        selectedStrokeId={selectedStrokeId}
        onLayerAction={(type, strokeId, value) => {
          setLayerActionTrigger({ type, strokeId, value });
        }}
      />

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

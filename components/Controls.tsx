import React from 'react';
import { COLORS, BG_COLORS, PenConfig, DrawingTool } from '../types';
import { 
  Paintbrush, 
  PenTool, 
  MousePointerClick, 
  Undo2, 
  Redo2, 
  Trash2, 
  Download, 
  Grid3X3, 
  Check, 
  HelpCircle,
  Eye,
  EyeOff,
  Magnet,
  Sparkles,
  Circle,
  Copy,
  FileCode
} from 'lucide-react';

interface ControlsProps {
  config: PenConfig;
  setConfig: React.Dispatch<React.SetStateAction<PenConfig>>;
  onClear: () => void;
  onOpenExportModal: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onFinishPath: () => void;
  onSmoothSelected: () => void;
  onToggleClosedSelected: () => void;
}

const Controls: React.FC<ControlsProps> = ({ 
  config, 
  setConfig, 
  onClear, 
  onOpenExportModal,
  onUndo,
  onRedo,
  onDeleteSelected,
  onFinishPath,
  onSmoothSelected,
  onToggleClosedSelected
}) => {
  const handleToolChange = (tool: DrawingTool) => {
    setConfig(prev => ({ ...prev, tool }));
  };

  return (
    <div className="absolute top-6 left-6 w-80 bg-white/95 backdrop-blur-md rounded-2xl p-6 z-10 flex flex-col gap-6 text-stone-800 max-h-[90vh] overflow-y-auto custom-scrollbar font-manrope">
      {/* Header with quick actions */}
      <div className="flex items-center justify-between">
        <button 
          onClick={onUndo}
          className="flex-1 py-2 flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-xl transition-all"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button 
          onClick={onRedo}
          className="flex-1 py-2 flex items-center justify-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-xl transition-all"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
        </button>
        <button 
          onClick={onClear}
          className="flex-1 py-2 flex items-center justify-center text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
          title="Clear Canvas"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button 
          onClick={onOpenExportModal}
          className="flex-1 py-2 flex items-center justify-center text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
          title="Export Artwork..."
        >
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* Tool Selection */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {/* Brush Tool */}
          <button
            onClick={() => handleToolChange('brush')}
            title="Brush Tool (B)"
            className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
              config.tool === 'brush'
                ? 'bg-stone-900 border-stone-900 text-white font-medium scale-[1.02]'
                : 'bg-stone-50 border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-100/80'
            }`}
          >
            <Paintbrush className="w-4 h-4 mb-1" />
            <span className="text-[10px] leading-tight font-semibold">Brush <span className="text-[9px] opacity-60">(B)</span></span>
          </button>

          {/* Bezier Pen Tool */}
          <button
            onClick={() => handleToolChange('bezier')}
            title="Bezier Pen Tool (P)"
            className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
              config.tool === 'bezier'
                ? 'bg-stone-900 border-stone-900 text-white font-medium scale-[1.02]'
                : 'bg-stone-50 border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-100/80'
            }`}
          >
            <PenTool className="w-4 h-4 mb-1" />
            <span className="text-[10px] leading-tight font-semibold">Bezier <span className="text-[9px] opacity-60">(P)</span></span>
          </button>

          {/* Direct Select Tool */}
          <button
            onClick={() => handleToolChange('select')}
            title="Direct Edit Tool (A)"
            className={`flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all ${
              config.tool === 'select'
                ? 'bg-stone-900 border-stone-900 text-white font-medium scale-[1.02]'
                : 'bg-stone-50 border-stone-200 text-stone-600 hover:text-stone-900 hover:bg-stone-100/80'
            }`}
          >
            <MousePointerClick className="w-4 h-4 mb-1" />
            <span className="text-[10px] leading-tight font-semibold">Edit <span className="text-[9px] opacity-60">(A)</span></span>
          </button>
        </div>

        {/* Sleek Context-Sensitive Action Buttons */}
        {config.tool === 'bezier' && (
          <button
            onClick={onFinishPath}
            className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 active:bg-stone-950 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all mt-2"
            title="Finish current path as an open shape (Enter)"
          >
            <Check className="w-4 h-4" />
            Complete Bezier Path
          </button>
        )}

        {config.tool === 'select' && (
          <div className="flex flex-col gap-2 mt-2">
            <button
              onClick={onSmoothSelected}
              className="w-full py-2.5 bg-stone-50 hover:bg-stone-100 active:bg-stone-200 text-amber-700 font-semibold text-xs rounded-xl border border-stone-200 flex items-center justify-center gap-1.5 transition-all"
              title="Recalculate control handles to make all corners of this path perfectly round and smooth"
            >
              <Sparkles className="w-4 h-4 text-amber-600" />
              Auto-Smooth Selected
            </button>

            <button
              onClick={onToggleClosedSelected}
              className="w-full py-2.5 bg-stone-50 hover:bg-stone-100 active:bg-stone-200 text-sky-700 font-semibold text-xs rounded-xl border border-stone-200 flex items-center justify-center gap-1.5 transition-all"
              title="Toggle between an open vector spline or a perfectly smooth closed loop"
            >
              <Circle className="w-4 h-4 text-sky-600" />
              Toggle Loop (Open/Closed)
            </button>
            
            <button
              onClick={onDeleteSelected}
              className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-semibold text-xs rounded-xl border border-red-200 flex items-center justify-center gap-1.5 transition-all"
              title="Delete the currently selected stroke (Del)"
            >
              <Trash2 className="w-4 h-4" />
              Delete Selected Stroke
            </button>
          </div>
        )}
      </div>

      {/* Main Parameters */}
      <div className="space-y-4">
        {/* Stroke Weight */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 px-3 py-1.5 bg-stone-50/50 border border-stone-250 rounded-xl">
            <input
              type="range"
              min="5"
              max="120"
              step="1"
              value={config.width}
              onChange={(e) => setConfig({ ...config, width: Number(e.target.value) })}
              className="flex-1 h-0.5 bg-stone-300 rounded appearance-none cursor-pointer accent-stone-900 hover:accent-stone-800"
            />
            <span className="text-stone-700 font-mono text-xs font-bold select-none min-w-[20px] text-right">
              {config.width}
            </span>
          </div>
        </div>

        {/* Stroke Cap */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Cap Ends</span>
          <div className="flex gap-1 bg-stone-100 p-0.5 rounded-lg">
            <button
              onClick={() => setConfig({ ...config, cap: 'round' })}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                config.cap === 'round'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Round
            </button>
            <button
              onClick={() => setConfig({ ...config, cap: 'square' })}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                config.cap === 'square'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              Square
            </button>
          </div>
        </div>
      </div>

      {/* Canvas and Ink */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block">Canvas and Ink</label>
        <div className="flex items-center gap-4">
          <div className="flex-1 space-y-1">
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Ink</span>
            <div className="flex items-center gap-[4.5px] border border-stone-300 rounded-lg p-[4.5px] bg-white w-fit">
              {COLORS.map((c) => {
                const isSelected = config.color === c;
                const isLightColor = ['#e0e0e0', '#fafab8', '#ebdcf9', '#d2e0fb', '#a5e8d7', '#fad3cb', '#fde7bf', '#DAB5CF'].includes(c);
                return (
                  <button
                    key={c}
                    onClick={() => setConfig({ ...config, color: c })}
                    className={`w-6 h-6 rounded-md border border-stone-900/10 transition-all flex items-center justify-center relative cursor-pointer hover:opacity-90 active:scale-95`}
                    style={{ backgroundColor: c }}
                    aria-label={`Select color ${c}`}
                  >
                    {isSelected && (
                      <span className={`w-2 h-2 rounded-full ${isLightColor ? 'bg-stone-800' : 'bg-white'}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 space-y-1">
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider block">Canvas</span>
            <div className="flex items-center gap-[4.5px] border border-stone-300 rounded-lg p-[4.5px] bg-white w-fit">
              {BG_COLORS.map((color) => {
                const isSelected = config.bgColor === color;
                const isLightColor = color === '#FFFBF1' || color === 'transparent';
                const style = color === 'transparent'
                  ? { backgroundImage: 'conic-gradient(#fafafa 25%, #eaeaea 0 50%, #fafafa 0 75%, #eaeaea 0)', backgroundSize: '10px 10px' }
                  : { backgroundColor: color };
                return (
                  <button
                    key={color}
                    onClick={() => setConfig({ ...config, bgColor: color })}
                    className={`w-6 h-6 rounded-md border border-stone-900/10 transition-all flex items-center justify-center relative cursor-pointer hover:opacity-90 active:scale-95`}
                    style={style}
                    aria-label={`Select background ${color}`}
                  >
                    {isSelected && (
                      <span className={`w-2 h-2 rounded-full ${isLightColor ? 'bg-stone-800' : 'bg-white'}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Export Options */}
      <div className="space-y-2">
        <button
          onClick={onOpenExportModal}
          className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 active:bg-stone-950 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-all"
          title="Open export options for PNG and scalable vector SVG"
        >
          <Download className="w-4 h-4 text-stone-200" />
          Export Masterpiece...
        </button>
      </div>
    </div>
  );
};

export default Controls;

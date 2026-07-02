import React, { useState } from 'react';
import { VectorStroke } from '../types';
import { 
  Layers, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  ArrowUpToLine, 
  ArrowDownToLine,
  PenTool, 
  Paintbrush,
  Check,
  X,
  Edit2
} from 'lucide-react';

interface LayersPanelProps {
  strokes: VectorStroke[];
  selectedStrokeId: string | null;
  onLayerAction: (
    type: 'select' | 'delete' | 'toggleVisibility' | 'toggleLock' | 'rename' | 'moveUp' | 'moveDown' | 'bringToFront' | 'sendToBack',
    strokeId: string,
    value?: any
  ) => void;
}

export const LayersPanel: React.FC<LayersPanelProps> = ({
  strokes,
  selectedStrokeId,
  onLayerAction
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Draw order: index 0 is bottom-most, last index is top-most.
  // In the Layer Panel, we show the top-most layer at the TOP of the list (index reversed).
  const reversedStrokes = [...strokes].reverse();

  const handleStartRename = (id: string, currentName: string, defaultName: string) => {
    setEditingId(id);
    setEditValue(currentName || defaultName);
  };

  const handleSaveRename = (id: string) => {
    if (editValue.trim()) {
      onLayerAction('rename', id, editValue.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleSaveRename(id);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  // Find currently selected stroke in list
  const selectedStrokeIndex = strokes.findIndex(s => s.id === selectedStrokeId);
  const isMoveUpEnabled = selectedStrokeId !== null && selectedStrokeIndex < strokes.length - 1;
  const isMoveDownEnabled = selectedStrokeId !== null && selectedStrokeIndex > 0;

  return (
    <div id="layers-panel" className="absolute top-6 right-6 w-80 bg-white/95 backdrop-blur-md rounded-2xl p-6 z-10 flex flex-col gap-4 text-stone-800 max-h-[90vh] overflow-y-auto custom-scrollbar font-manrope shadow-xl border border-stone-200/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-stone-600" />
          <h2 className="text-sm font-semibold tracking-tight text-stone-900">Paths & Layers</h2>
        </div>
        <span className="text-xs font-semibold bg-stone-100 px-2 py-0.5 rounded-full text-stone-500">
          {strokes.length} {strokes.length === 1 ? 'path' : 'paths'}
        </span>
      </div>

      {/* Layer Action Toolbar (Active when a path is selected) */}
      <div className="flex items-center justify-between gap-1 bg-stone-50 p-1.5 rounded-xl border border-stone-200/40">
        <button
          onClick={() => selectedStrokeId && onLayerAction('bringToFront', selectedStrokeId)}
          disabled={!isMoveUpEnabled}
          className={`p-2 rounded-lg flex-1 flex items-center justify-center transition-all ${
            isMoveUpEnabled 
              ? 'text-stone-600 hover:text-stone-950 hover:bg-white shadow-sm' 
              : 'text-stone-300 cursor-not-allowed'
          }`}
          title="Bring to Front (Draw Last)"
        >
          <ArrowUpToLine className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => selectedStrokeId && onLayerAction('moveUp', selectedStrokeId)}
          disabled={!isMoveUpEnabled}
          className={`p-2 rounded-lg flex-1 flex items-center justify-center transition-all ${
            isMoveUpEnabled 
              ? 'text-stone-600 hover:text-stone-950 hover:bg-white shadow-sm' 
              : 'text-stone-300 cursor-not-allowed'
          }`}
          title="Move Forward"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => selectedStrokeId && onLayerAction('moveDown', selectedStrokeId)}
          disabled={!isMoveDownEnabled}
          className={`p-2 rounded-lg flex-1 flex items-center justify-center transition-all ${
            isMoveDownEnabled 
              ? 'text-stone-600 hover:text-stone-950 hover:bg-white shadow-sm' 
              : 'text-stone-300 cursor-not-allowed'
          }`}
          title="Move Backward"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => selectedStrokeId && onLayerAction('sendToBack', selectedStrokeId)}
          disabled={!isMoveDownEnabled}
          className={`p-2 rounded-lg flex-1 flex items-center justify-center transition-all ${
            isMoveDownEnabled 
              ? 'text-stone-600 hover:text-stone-950 hover:bg-white shadow-sm' 
              : 'text-stone-300 cursor-not-allowed'
          }`}
          title="Send to Back (Draw First)"
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-5 bg-stone-200 mx-1" />
        <button
          onClick={() => {
            if (selectedStrokeId) {
              const s = strokes.find(st => st.id === selectedStrokeId);
              if (s) {
                const defaultName = s.tool === 'bezier' ? 'Bezier Path' : 'Brush Stroke';
                handleStartRename(s.id, s.name || '', defaultName);
              }
            }
          }}
          disabled={!selectedStrokeId}
          className={`p-2 rounded-lg flex-1 flex items-center justify-center transition-all ${
            selectedStrokeId 
              ? 'text-stone-600 hover:text-stone-950 hover:bg-white shadow-sm' 
              : 'text-stone-300 cursor-not-allowed'
          }`}
          title="Rename Path"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => selectedStrokeId && onLayerAction('delete', selectedStrokeId)}
          disabled={!selectedStrokeId}
          className={`p-2 rounded-lg flex-1 flex items-center justify-center transition-all ${
            selectedStrokeId 
              ? 'text-red-500 hover:text-red-600 hover:bg-red-50 hover:border-red-100' 
              : 'text-stone-300 cursor-not-allowed'
          }`}
          title="Delete Path"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Layer List Area */}
      <div className="flex flex-col gap-1 overflow-y-auto max-h-[50vh] pr-1">
        {reversedStrokes.length === 0 ? (
          <div className="text-center py-8 text-stone-400 text-xs">
            No paths drawn yet. Add your first strokes to see them listed here.
          </div>
        ) : (
          reversedStrokes.map((stroke, revIdx) => {
            const actualIndex = strokes.length - 1 - revIdx;
            const isSelected = selectedStrokeId === stroke.id;
            const isVisible = stroke.isVisible !== false;
            const isLocked = stroke.isLocked === true;
            const defaultName = stroke.tool === 'bezier' ? `Bezier Path ${actualIndex + 1}` : `Brush Stroke ${actualIndex + 1}`;
            const displayName = stroke.name || defaultName;

            return (
              <div
                key={stroke.id}
                className={`group flex items-center justify-between p-2 rounded-xl border transition-all ${
                  isSelected
                    ? 'bg-stone-900 border-stone-900 text-white shadow-sm'
                    : 'bg-white hover:bg-stone-50 border-stone-100 text-stone-700 hover:border-stone-200/70'
                }`}
              >
                {/* Left Side: Drag preview pill, Tool Icon, Name */}
                <div 
                  className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                  onClick={() => !isLocked && isVisible && onLayerAction('select', stroke.id)}
                >
                  {/* Miniature Ink Preview */}
                  <div 
                    className="w-3.5 h-3.5 rounded-full border border-stone-200/50 flex-shrink-0"
                    style={{ 
                      backgroundColor: stroke.color,
                      opacity: stroke.opacity || 1
                    }}
                  />

                  {/* Tool Icon */}
                  <div className={`flex-shrink-0 ${isSelected ? 'text-stone-300' : 'text-stone-400'}`}>
                    {stroke.tool === 'bezier' ? (
                      <PenTool className="w-3.5 h-3.5" />
                    ) : (
                      <Paintbrush className="w-3.5 h-3.5" />
                    )}
                  </div>

                  {/* Name field or Rename Input */}
                  {editingId === stroke.id ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => handleSaveRename(stroke.id)}
                        onKeyDown={e => handleKeyDown(e, stroke.id)}
                        className={`text-xs px-1.5 py-0.5 rounded border focus:outline-none w-full ${
                          isSelected 
                            ? 'bg-stone-800 border-stone-700 text-white focus:border-stone-500' 
                            : 'bg-stone-50 border-stone-200 text-stone-900 focus:border-stone-400'
                        }`}
                        autoFocus
                      />
                      <button 
                        onClick={() => handleSaveRename(stroke.id)}
                        className={`p-0.5 rounded hover:bg-stone-100 ${isSelected ? 'hover:bg-stone-800' : ''}`}
                      >
                        <Check className="w-3 h-3 text-emerald-500" />
                      </button>
                    </div>
                  ) : (
                    <span 
                      className="text-xs font-medium truncate select-none flex-1"
                      onDoubleClick={() => handleStartRename(stroke.id, stroke.name || '', defaultName)}
                      title="Double-click to rename"
                    >
                      {displayName}
                    </span>
                  )}
                </div>

                {/* Right Side: Lock/Eye/Trash Controls */}
                <div className="flex items-center gap-0.5 flex-shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                  {/* Visibility Button */}
                  <button
                    onClick={() => onLayerAction('toggleVisibility', stroke.id)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isSelected
                        ? 'hover:bg-stone-800 text-stone-300 hover:text-white'
                        : 'hover:bg-stone-100 text-stone-400 hover:text-stone-800'
                    }`}
                    title={isVisible ? 'Hide Path' : 'Show Path'}
                  >
                    {isVisible ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-400" />
                    )}
                  </button>

                  {/* Lock Button */}
                  <button
                    onClick={() => onLayerAction('toggleLock', stroke.id)}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isSelected
                        ? 'hover:bg-stone-800 text-stone-300 hover:text-white'
                        : 'hover:bg-stone-100 text-stone-400 hover:text-stone-800'
                    }`}
                    title={isLocked ? 'Unlock Path' : 'Lock Path'}
                  >
                    {isLocked ? (
                      <Lock className="w-3.5 h-3.5 text-amber-500" />
                    ) : (
                      <Unlock className={`w-3.5 h-3.5 ${isSelected ? 'text-stone-500 hover:text-white' : 'text-stone-300 group-hover:text-stone-400'}`} />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Instructions */}
      <div className="text-[10px] text-stone-400 border-t border-stone-100 pt-2 leading-relaxed">
        Double-click any path name to rename. Draw paths last to layer them on top, or reorder them using the toolbar.
      </div>
    </div>
  );
};

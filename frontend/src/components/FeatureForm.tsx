import React from 'react';
import StreetlightsForm from '../features/streetlights/StreetlightsForm';
import RoadsForm from '../features/roads/RoadsForm';
import ZonesForm from '../features/zones/ZonesForm';
import DistrictsForm from '../features/districts/DistrictsForm';
import StatesForm from '../features/states/StatesForm';
import { IconMapPin } from './Icons';
import DynamicFeatureForm from './DynamicFeatureForm';

interface FeatureFormProps {
  feature: any | null;
  mode: 'idle' | 'create' | 'edit' | 'move' | 'vertex_edit';
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | string | null;
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string, layerName?: string) => void;
  onCancel: () => void;
  onMoveStart: () => void;
  selectedZoneFeature?: any;
  selectedRoadFeature?: any;
}

const FeatureForm: React.FC<FeatureFormProps> = ({
  feature,
  mode,
  activeLayer,
  onSuccess,
  onCancel,
  onMoveStart,
  selectedZoneFeature,
  selectedRoadFeature,
}) => {
  if (mode === 'idle' || !activeLayer) {
    return (
      <div className="inspector-empty">
        <IconMapPin width={40} height={40} />
        <div className="inspector-empty-title">
          No feature selected
        </div>
        <div className="inspector-empty-hint">
          Click any infrastructure asset on<br />the map to inspect and edit it.
        </div>
      </div>
    );
  }

  if (mode === 'move') {
    return (
      <div className="inspector-empty">
        <IconMapPin width={40} height={40} />
        <div className="inspector-empty-title">Move Feature</div>
        <div className="inspector-empty-hint">Drag the feature on the map to move it.</div>
        <div className="inspector-actions" style={{ marginTop: '20px', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel Move</button>
        </div>
      </div>
    );
  }

  const formMode = mode === 'vertex_edit' ? 'edit' : mode;

  switch (activeLayer) {
    case 'streetlights':
      return (
        <StreetlightsForm
          feature={feature}
          mode={formMode}
          onSuccess={onSuccess}
          onCancel={onCancel}
          onMoveStart={onMoveStart}
          selectedZoneFeature={selectedZoneFeature}
          selectedRoadFeature={selectedRoadFeature}
        />
      );
    case 'roads':
      return (
        <RoadsForm
          feature={feature}
          mode={formMode}
          onSuccess={onSuccess}
          onCancel={onCancel}
          onMoveStart={onMoveStart}
          selectedZoneFeature={selectedZoneFeature}
        />
      );
    case 'zones':
      return (
        <ZonesForm
          feature={feature}
          mode={formMode}
          onSuccess={onSuccess}
          onCancel={onCancel}
          onMoveStart={onMoveStart}
        />
      );
    case 'states':
      return (
        <StatesForm
          feature={feature}
          mode={formMode}
          onSuccess={onSuccess}
          onCancel={onCancel}
          onMoveStart={onMoveStart}
        />
      );
    case 'districts':
      return (
        <DistrictsForm
          feature={feature}
          mode={formMode}
          onSuccess={onSuccess}
          onCancel={onCancel}
          onMoveStart={onMoveStart}
        />
      );
    default:
      // Fallback for dynamic layers
      return (
        <DynamicFeatureForm
          feature={feature}
          mode={formMode}
          layerName={activeLayer}
          onSuccess={onSuccess}
          onCancel={onCancel}
          onMoveStart={onMoveStart}
        />
      );
  }
};

export default FeatureForm;

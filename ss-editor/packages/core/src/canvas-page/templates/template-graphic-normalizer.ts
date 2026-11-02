// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Template graphic normalizer
 *
 * Templates use a simplified flat format ({ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: '#xxx' }),
 * but GraphicFactory.createGraphicFromJSON + BaseGraphic.fromJSON require the standard normalized format
 * ({ type: 'shape', config: { geometry: {...}, style: {...}, customProps: {...} } }).
 *
 * This utility converts the flat format into the standard format and maps type names (rect→shape, text→label).
 */

/** Template type → registered type mapping */
const TYPE_MAP: Record<string, string> = {
  rect: 'shape',
  text: 'label',
};

/** Common style fields (extracted directly from flat properties) */
const COMMON_STYLE_KEYS: Record<string, string> = {
  fill: 'backgroundColor',
  fillOpacity: 'fillOpacity',
  stroke: 'borderColor',
  strokeWidth: 'borderWidth',
  strokeStyle: 'borderStyle',
  cornerRadius: 'borderRadius',
  opacity: 'opacity',
  fontSize: 'fontSize',
  fontFamily: 'fontFamily',
  fontStyle: 'fontStyle',
  fontWeight: 'fontWeight',
  textAlign: 'textAlign',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  shadowBlur: 'shadowBlur',
  shadowColor: 'shadowColor',
  shadowOffsetX: 'shadowOffsetX',
  shadowOffsetY: 'shadowOffsetY',
};

export function normalizeTemplateGraphics(flatGraphics: Record<string, any>[]): Record<string, any>[] {
  return flatGraphics.map((flat) => {
    // If already in standard format (has a config property), pass through directly
    if (flat.config && typeof flat.config === 'object') {
      return flat;
    }

    const graphicType = TYPE_MAP[flat.type] || flat.type;
    const id = flat.id || `${graphicType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const geometry = {
      x: flat.x ?? flat.left ?? 0,
      y: flat.y ?? flat.top ?? 0,
      width: flat.width ?? 100,
      height: flat.height ?? 100,
      rotation: flat.rotation ?? 0,
      scale: flat.scale ?? 1,
    };

    const style: Record<string, any> = {};
    for (const [flatKey, styleKey] of Object.entries(COMMON_STYLE_KEYS)) {
      if (flat[flatKey] !== undefined) {
        style[styleKey] = flat[flatKey];
      }
    }

    // Handle gradient fill
    if (flat.fill && typeof flat.fill === 'object' && flat.fill.type === 'gradient') {
      style.backgroundColor = flat.fill.colors?.[0] || '#808080';
      (style as any).gradient = flat.fill;
    }

    // Handle stroke: 'none'
    if (flat.stroke === 'none') {
      style.borderColor = 'transparent';
      style.borderWidth = style.borderWidth ?? 0;
    }

    const config: Record<string, any> = {
      id,
      type: graphicType,
      name: flat.name || flat.text || `${graphicType}_1`,
      geometry,
      style,
      isGroup: flat.isGroup ?? false,
      groupId: flat.groupId ?? null,
      groupMembers: flat.groupMembers ?? [],
      customProps: buildCustomProps(flat, graphicType),
      locked: flat.locked ?? false,
      visible: flat.visible ?? true,
      disabled: flat.disabled ?? false,
      zIndex: flat.zIndex ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    return {
      id,
      type: graphicType,
      version: '1.0',
      config,
    };
  });
}

function buildCustomProps(flat: Record<string, any>, graphicType: string): Record<string, any> {
  const props: Record<string, any> = {};

  switch (graphicType) {
    case 'shape': {
      props.shapeType = flat.shapeType || 'rectangle';
      if (!flat.fill || (typeof flat.fill === 'object' && flat.fill.type === 'gradient')) {
        props.fillColor = '#808080';
      } else {
        props.fillColor = typeof flat.fill === 'string' ? flat.fill : '#808080';
      }
      props.fillOpacity = flat.fillOpacity ?? 1;
      props.borderColor = flat.stroke === 'none' ? 'transparent' : (flat.stroke || 'transparent');
      props.borderWidth = flat.strokeWidth ?? (flat.stroke === 'none' ? 0 : 0);
      props.borderStyle = flat.strokeStyle || 'solid';
      props.borderRadius = flat.cornerRadius ?? 0;
      break;
    }
    case 'label': {
      props.text = flat.text || flat.value || '';
      props.fontSize = flat.fontSize ?? 14;
      props.fontColor = flat.fill || flat.fontColor || '#000000';
      props.fontWeight = flat.fontWeight || 'normal';
      props.fontStyle = flat.fontStyle || 'normal';
      props.textDecoration = flat.textDecoration || 'none';
      props.textAlign = flat.textAlign || 'left';
      props.verticalAlignment = flat.verticalAlignment || 'middle';
      props.lineHeight = flat.lineHeight ?? 1.5;
      props.letterSpacing = flat.letterSpacing ?? 0;
      props.wordWrap = flat.wordWrap ?? false;
      props.maxLines = flat.maxLines ?? 0;
      props.backgroundColor = 'transparent';
      props.borderColor = 'transparent';
      props.borderWidth = 0;
      props.borderRadius = 0;
      break;
    }
    case 'button': {
      props.text = flat.text || flat.label || '按钮';
      props.backgroundColor = flat.backgroundColor || flat.fill || '#2196f3';
      props.fontColor = flat.fontColor || flat.textColor || '#ffffff';
      props.borderColor = flat.borderColor || flat.stroke || '#1976d2';
      props.borderWidth = flat.borderWidth ?? 1;
      props.borderStyle = flat.borderStyle || 'solid';
      props.borderRadius = flat.cornerRadius ?? 4;
      props.fontSize = flat.fontSize ?? 14;
      props.fontWeight = flat.fontWeight || 'normal';
      props.textAlign = flat.textAlign || 'center';
      break;
    }
    case 'image': {
      props.src = flat.src || '';
      props.opacity = flat.opacity ?? 1;
      props.imageFit = flat.imageFit || 'contain';
      break;
    }
    case 'input': {
      props.value = flat.value || flat.text || '';
      props.placeholder = flat.placeholder || '请输入...';
      props.backgroundColor = flat.backgroundColor || flat.fill || '#ffffff';
      props.borderColor = flat.borderColor || flat.stroke || '#ced4da';
      props.borderWidth = flat.borderWidth ?? 1;
      props.borderStyle = flat.borderStyle || 'solid';
      props.borderRadius = flat.cornerRadius ?? 4;
      props.fontSize = flat.fontSize ?? 14;
      props.fontWeight = flat.fontWeight || 'normal';
      props.fontColor = flat.fontColor || flat.textColor || '#333333';
      props.textAlign = flat.textAlign || 'left';
      break;
    }
    default: {
      // Pass through common properties
      for (const key of Object.keys(flat)) {
        if (!['id', 'type', 'x', 'y', 'width', 'height', 'left', 'top', 'rotation',
          'fill', 'stroke', 'strokeWidth', 'strokeStyle', 'cornerRadius', 'opacity',
          'fontSize', 'fontFamily', 'fontStyle', 'fontWeight', 'textAlign',
          'lineHeight', 'letterSpacing', 'scale', 'isGroup', 'groupId', 'groupMembers',
          'locked', 'visible', 'disabled', 'zIndex', 'name', 'shapeType'].includes(key)) {
          props[key] = flat[key];
        }
      }
      break;
    }
  }

  return props;
}

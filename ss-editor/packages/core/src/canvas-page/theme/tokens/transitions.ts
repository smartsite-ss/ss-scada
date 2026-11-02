// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Transition and animation design tokens

// Transition durations
export const transitionDurations = {
  // Fast
  fast: '0.2s',
  // Normal
  normal: '0.3s',
  // Slow
  slow: '0.5s',

  // Common component transitions
  button: '0.2s',
  input: '0.2s',
  card: '0.3s',
  modal: '0.3s',
  dropdown: '0.2s',
};

// Transition easing functions
export const transitionEasings = {
  // Linear
  linear: 'linear',
  // Ease in
  easeIn: 'ease-in',
  // Ease out
  easeOut: 'ease-out',
  // Ease in-out
  easeInOut: 'ease-in-out',

  // Elastic
  elastic: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  // Bounce
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  // Smooth
  smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

// Transition properties
export const transitionProperties = {
  // All properties
  all: 'all',
  // Color
  color: 'color',
  // Background color
  backgroundColor: 'background-color',
  // Border
  border: 'border',
  // Transform
  transform: 'transform',
  // Opacity
  opacity: 'opacity',
  // Width
  width: 'width',
  // Height
  height: 'height',
};

// Transition utility functions
export const transitionUtils = {
  // Get transition style
  getTransition: (property: keyof typeof transitionProperties, duration: keyof typeof transitionDurations, easing: keyof typeof transitionEasings) => {
    return `${transitionProperties[property]} ${transitionDurations[duration]} ${transitionEasings[easing]}`;
  },

  // Get default transition
  getDefaultTransition: () => {
    return `${transitionProperties.all} ${transitionDurations.normal} ${transitionEasings.easeInOut}`;
  },
};

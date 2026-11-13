<template>
  <svg
    :width="size || 24"
    :height="size || 24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- Inlet pipe (left) -->
    <rect
      x="1"
      y="10"
      width="5"
      height="4"
      rx="0.8"
      :fill="color"
      opacity="0.85"
    />
    
    <!-- Inlet flange -->
    <rect
      x="5.5"
      y="9.7"
      width="1.2"
      height="4.6"
      rx="0.3"
      :fill="darkenColor"
    />
    
    <!-- Pump body (square-rounded industrial shell) -->
    <rect
      x="6.5"
      y="6"
      width="11"
      height="12"
      rx="2"
      :fill="color"
    />
    <!-- Pump body highlight -->
    <rect
      x="7"
      y="6.5"
      width="10"
      height="3.5"
      rx="1.5"
      :fill="highlightColor"
      fill-opacity="0.25"
    />
    <!-- Impeller housing groove -->
    <rect
      x="8.5"
      y="8"
      width="7"
      height="8"
      rx="1.2"
      :fill="darkColor"
      opacity="0.5"
    />

    <!-- Outlet flange -->
    <rect
      x="17.3"
      y="9.6"
      width="1.3"
      height="4.8"
      rx="0.3"
      :fill="darkenColor"
    />

    <!-- Outlet pipe (right) -->
    <rect
      x="18.5"
      y="10"
      width="4.5"
      height="4"
      rx="0.8"
      :fill="color"
      opacity="0.85"
    />

    <!-- Impeller (8 blades + center shaft) -->
    <g :transform="`rotate(${rotation}, 12, 12)`">
      <!-- Impeller backplate -->
      <circle
        cx="12"
        cy="12"
        r="3.5"
        :fill="innerColor"
        opacity="0.6"
      />
      <!-- 8 blades (simplified representation) -->
      <g :fill="innerColor">
        <rect
          x="11.7"
          y="7.8"
          width="0.6"
          height="4.2"
          rx="0.2"
        />
        <rect
          x="11.7"
          y="12"
          width="0.6"
          height="4.2"
          rx="0.2"
        />
        <rect
          x="7.8"
          y="11.7"
          width="4.2"
          height="0.6"
          rx="0.2"
        />
        <rect
          x="12"
          y="11.7"
          width="4.2"
          height="0.6"
          rx="0.2"
        />
        <!-- Diagonal blade -->
        <rect
          x="9.2"
          y="9.2"
          width="0.55"
          height="3"
          rx="0.2"
          transform="rotate(45 12 12)"
        />
        <rect
          x="14.2"
          y="9.2"
          width="0.55"
          height="3"
          rx="0.2"
          transform="rotate(-45 12 12)"
        />
        <rect
          x="9.2"
          y="12.8"
          width="0.55"
          height="3"
          rx="0.2"
          transform="rotate(-45 12 12)"
        />
        <rect
          x="14.2"
          y="12.8"
          width="0.55"
          height="3"
          rx="0.2"
          transform="rotate(45 12 12)"
        />
      </g>
      <!-- Center hub -->
      <circle
        cx="12"
        cy="12"
        r="1.4"
        :fill="darkInnerColor"
      />
      <circle
        cx="12"
        cy="12"
        r="0.5"
        fill="#334"
      />
    </g>

    <!-- Four-corner bolt dots -->
    <circle
      cx="8.2"
      cy="7.8"
      r="0.6"
      fill="#89A"
      stroke="#678"
      stroke-width="0.3"
    />
    <circle
      cx="15.8"
      cy="7.8"
      r="0.6"
      fill="#89A"
      stroke="#678"
      stroke-width="0.3"
    />
    <circle
      cx="8.2"
      cy="16.2"
      r="0.6"
      fill="#89A"
      stroke="#678"
      stroke-width="0.3"
    />
    <circle
      cx="15.8"
      cy="16.2"
      r="0.6"
      fill="#89A"
      stroke="#678"
      stroke-width="0.3"
    />

    <!-- Base -->
    <rect
      x="6"
      y="18.5"
      width="12"
      height="2.5"
      rx="0.6"
      :fill="darkColor"
    />
    <rect
      x="7.5"
      y="20.5"
      width="2"
      height="1.2"
      rx="0.3"
      :fill="darkColor"
      opacity="0.8"
    />
    <rect
      x="14.5"
      y="20.5"
      width="2"
      height="1.2"
      rx="0.3"
      :fill="darkColor"
      opacity="0.8"
    />

    <!-- Tag area -->
    <rect
      x="9"
      y="19"
      width="6"
      height="1.6"
      rx="0.4"
      fill="#EEF2F6"
      stroke="#BBC"
      stroke-width="0.3"
    />
    <text
      x="12"
      y="20.05"
      text-anchor="middle"
      font-size="0.65"
      font-weight="bold"
      fill="#567"
    >P-001</text>

    <!-- Status indicator light -->
    <circle
      cx="5.5"
      cy="9"
      r="1.1"
      fill="#234"
    />
    <circle
      cx="5.5"
      cy="9"
      r="0.9"
      :fill="statusColor"
    />
    <circle
      cx="5.25"
      cy="8.75"
      r="0.3"
      fill="white"
      fill-opacity="0.5"
    />
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  size?: number;
  color?: string;
  innerColor?: string;
  highlightColor?: string;
  statusColor?: string;
  rotation?: number;
  darkenColor?: string;
  darkColor?: string;
  darkInnerColor?: string;
}>();
</script>

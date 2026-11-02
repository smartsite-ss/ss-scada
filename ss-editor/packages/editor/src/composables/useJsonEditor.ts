// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { ref, watch } from 'vue'
import { usePageStore, useGraphicStore } from '@scada-editor/core'

// Simple debounce implementation
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
    }, delay)
  }
}

export function useJsonEditor() {
  const pageStore = usePageStore()
  const graphicStore = useGraphicStore()

  // JSON content
  const jsonContent = ref('')
  // Whether there is an error
  const hasError = ref(false)
  // Error message
  const errorMessage = ref('')

  // Generate JSON data
  const generateJsonData = () => {
    const currentPage = pageStore.currentPage
    if (!currentPage) {
      return {
        version: '1.0',
        page: {
          id: '',
          name: '',
          width: 1920,
          height: 1080,
          backgroundColor: '#ffffff',
        },
        graphics: [],
        timers: [],
        groups: [],
      }
    }

    // Use BasePage.toJSON() directly to get the complete data
    const pageData = currentPage.toJSON()
    
    return {
      version: '1.0',
      page: {
        id: pageData.id,
        name: pageData.name,
        width: pageData.width,
        height: pageData.height,
        backgroundColor: pageData.backgroundColor,
        backgroundImage: pageData.backgroundImage || '',
        backgroundApplicationType: (currentPage as any).backgroundApplicationType || 'applicationColor',
        backgroundFitMode: (currentPage as any).backgroundFitMode || 'stretch',
      },
      graphics: pageData.graphics,
      timers: pageData.timers,
      groups: pageData.groups,
    }
  }

  // Refresh JSON content
  const refreshJson = () => {
    try {
      const data = generateJsonData()
      jsonContent.value = JSON.stringify(data, null, 2)
      hasError.value = false
      errorMessage.value = ''
    } catch (error) {
      console.error('Failed to refresh JSON:', error)
      hasError.value = true
      errorMessage.value = 'Failed to generate JSON'
    }
  }

  // Apply JSON changes
  const applyJson = (jsonString: string): boolean => {
    try {
      const data = JSON.parse(jsonString)

      const currentPage = pageStore.currentPage
      if (!currentPage) {
        hasError.value = true
        errorMessage.value = 'No current page found'
        return false
      }

      // Detect the data format: two formats supported
      // 1. JSON panel format: { version, page, graphics, timers, groups }
      // 2. Direct toJSON format: { id, name, graphics, groups, timers, ... }
      let pageData = data
      let graphicsData = data.graphics
      let timersData = data.timers
      let groupsData = data.groups

      // If it is the JSON panel format, extract the data
      if (data.version && data.page) {
        pageData = data.page
        graphicsData = data.graphics
        timersData = data.timers
        groupsData = data.groups
      }

      if (!Array.isArray(graphicsData)) {
        hasError.value = true
        errorMessage.value = 'Invalid JSON format: graphics array is required'
        return false
      }

      // Save a history record
      (graphicStore as any).saveHistory?.()

      // Update page properties
      pageStore.updatePage(currentPage.id, {
        name: pageData.name,
        width: pageData.width,
        height: pageData.height,
        backgroundColor: pageData.backgroundColor,
        backgroundImage: pageData.backgroundImage,
      } as any)

      // Use the page's importGraphics method, which correctly rebuilds the managers
      currentPage.importGraphics(graphicsData)

      // Import timers
      if (timersData && Array.isArray(timersData)) {
        const timerManager = (currentPage as any).timerManager
        if (timerManager && timerManager.fromJSON) {
          timerManager.fromJSON(timersData)
        }
      }

      // Import groups
      if (groupsData && Array.isArray(groupsData)) {
        const groupManager = (currentPage as any).getGroupManager?.()
        if (groupManager && groupManager.fromJSON) {
          groupManager.fromJSON(groupsData)
          // Ensure references are updated
          const graphics =
            'value' in currentPage.graphics
              ? currentPage.graphics.value
              : currentPage.graphics
          const graphicMap = new Map((graphics as any[]).map((g: any) => [g.id, g]))
          groupManager.updateReferences?.(graphics, graphicMap)
        }
      }

      hasError.value = false
      errorMessage.value = ''
      return true
    } catch (error) {
      console.error('Failed to apply JSON:', error)
      hasError.value = true
      errorMessage.value = error instanceof Error ? error.message : 'Invalid JSON format'
      return false
    }
  }

  // Format JSON
  const formatJson = (jsonString: string): string => {
    try {
      const data = JSON.parse(jsonString)
      return JSON.stringify(data, null, 2)
    } catch (error) {
      return jsonString
    }
  }

  // Validate JSON
  const validateJson = (jsonString?: string): boolean => {
    try {
      const content = jsonString ?? jsonContent.value
      JSON.parse(content)
      hasError.value = false
      errorMessage.value = ''
      return true
    } catch (error) {
      hasError.value = true
      errorMessage.value = error instanceof Error ? error.message : 'Invalid JSON format'
      return false
    }
  }

  // Copy JSON to clipboard (copies the raw JSON data of the entire page)
  const copyJson = async () => {
    try {
      const data = generateJsonData()
      const jsonString = JSON.stringify(data, null, 2)
      await navigator.clipboard.writeText(jsonString)
    } catch (error) {
      console.error('Failed to copy JSON:', error)
    }
  }

  // Export JSON file
  const exportJson = (jsonString: string) => {
    try {
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const currentPage = pageStore.currentPage
      a.download = `${currentPage?.name || 'scada-page'}-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to export JSON:', error)
    }
  }

  // Import JSON file
  const importJson = () => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json'
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (file) {
          const text = await file.text()
          jsonContent.value = text
          applyJson(text)
        }
      }
      input.click()
    } catch (error) {
      console.error('Failed to import JSON:', error)
    }
  }

  // Watch page and graphics changes, auto-refresh JSON (with debounce)
  const debouncedRefresh = debounce(refreshJson, 300)

  // Watch pageStore changes to pick up currentPage changes
  watch(
    () => pageStore.currentPage,
    (newPage) => {
      if (newPage) {
        watch(
          [
            () => newPage.graphics,
            () => newPage.selectedGraphicIds,
            () => newPage.selectedGraphicId,
            () => newPage.backgroundColor,
            () => newPage.name,
            () => (newPage as any).timerManager,
            () => (newPage as any).getGroupManager?.().getAllGroups?.()
          ],
          () => {
            debouncedRefresh()
          },
          { deep: true }
        )
      }
    },
    { immediate: true }
  )

  // Refresh once at initialization
  refreshJson()

  return {
    jsonContent,
    hasError,
    errorMessage,
    refreshJson,
    applyJson,
    formatJson,
    copyJson,
    exportJson,
    importJson,
    validateJson,
  }
}

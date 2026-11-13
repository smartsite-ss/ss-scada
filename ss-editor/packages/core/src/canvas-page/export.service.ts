// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IPage } from '../types';

/**
 * Export service
 * Supports exporting the design to different formats
 */
export class ExportService {
  /**
   * Export as PNG format
   * @param canvas Canvas element
   * @param filename File name
   */
  static exportAsPNG(
    canvas: HTMLCanvasElement,
    filename: string = 'design.png'
  ): void {
    try {
      const dataURL = canvas.toDataURL('image/png');
      this.downloadFile(dataURL, filename);
    } catch (error) {
      console.error('Failed to export PNG:', error);
      throw error;
    }
  }

  /**
   * Export as JPEG format
   * @param canvas Canvas element
   * @param filename File name
   * @param quality Image quality (0-1)
   */
  static exportAsJPEG(
    canvas: HTMLCanvasElement,
    filename: string = 'design.jpg',
    quality: number = 0.9
  ): void {
    try {
      const dataURL = canvas.toDataURL('image/jpeg', quality);
      this.downloadFile(dataURL, filename);
    } catch (error) {
      console.error('Failed to export JPEG:', error);
      throw error;
    }
  }

  /**
   * Export as SVG format
   * @param page Page object
   * @param filename File name
   */
  static exportAsSVG(page: IPage, filename: string = 'design.svg'): void {
    try {
      const svgContent = this.generateSVG(page);
      const dataURL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`;
      this.downloadFile(dataURL, filename);
    } catch (error) {
      console.error('Failed to export SVG:', error);
      throw error;
    }
  }

  /**
   * Export as JSON format
   * @param page Page object
   * @param filename File name
   */
  static exportAsJSON(page: IPage, filename: string = 'design.json'): void {
    try {
      const jsonContent = JSON.stringify(page, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      this.downloadFile(url, filename);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export JSON:', error);
      throw error;
    }
  }

  /**
   * Download a file
   * @param url File URL
   * @param filename File name
   */
  private static downloadFile(url: string, filename: string): void {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Generate SVG content
   * @param page Page object
   * @returns SVG content
   */
  private static generateSVG(page: IPage): string {
    const { width, height } = page.getSize();
    let svgContent = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

    // Draw graphics
    const graphics = page.getGraphics();
    graphics.forEach((graphic) => {
      const { x, y } = graphic.getPosition();
      const { width: graphicWidth, height: graphicHeight } = graphic.getSize();
      const props = graphic.config.customProps;

      switch (graphic.type) {
        case 'button':
          svgContent += this.generateButtonSVG(
            x,
            y,
            graphicWidth,
            graphicHeight,
            props
          );
          break;
        case 'label':
          svgContent += this.generateLabelSVG(
            x,
            y,
            graphicWidth,
            graphicHeight,
            props
          );
          break;
        case 'input':
          svgContent += this.generateInputSVG(
            x,
            y,
            graphicWidth,
            graphicHeight,
            props
          );
          break;
        case 'image':
          svgContent += this.generateImageSVG(
            x,
            y,
            graphicWidth,
            graphicHeight,
            props
          );
          break;
        case 'shape':
          svgContent += this.generateShapeSVG(
            x,
            y,
            graphicWidth,
            graphicHeight,
            props
          );
          break;
        case 'textbox':
          svgContent += this.generateTextboxSVG(
            x,
            y,
            graphicWidth,
            graphicHeight,
            props
          );
          break;
        default:
          break;
      }
    });

    svgContent += '</svg>';
    return svgContent;
  }

  /**
   * Generate SVG for a button
   * @param x X coordinate
   * @param y Y coordinate
   * @param width Width
   * @param height Height
   * @param props Properties
   * @returns SVG string
   */
  private static generateButtonSVG(
    x: number,
    y: number,
    width: number,
    height: number,
    props: any
  ): string {
    const {
      text,
      backgroundColor,
      textColor,
      borderColor,
      borderWidth,
      borderRadius,
    } = props;
    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" 
        rx="${borderRadius}" ry="${borderRadius}" 
        fill="${backgroundColor}" 
        stroke="${borderColor}" 
        stroke-width="${borderWidth}" />
      <text x="${x + width / 2}" y="${y + height / 2 + 5}" 
        text-anchor="middle" 
        fill="${textColor}" 
        font-size="14">${text}</text>
    `;
  }

  /**
   * Generate SVG for a label
   * @param x X coordinate
   * @param y Y coordinate
   * @param width Width
   * @param height Height
   * @param props Properties
   * @returns SVG string
   */
  private static generateLabelSVG(
    x: number,
    y: number,
    width: number,
    height: number,
    props: any
  ): string {
    const { text, textColor, fontSize, fontWeight, textAlign } = props;
    let textAnchor = 'middle';
    if (textAlign === 'left') textAnchor = 'start';
    if (textAlign === 'right') textAnchor = 'end';
    return `
      <text x="${x + width / 2}" y="${y + height / 2 + 5}" 
        text-anchor="${textAnchor}" 
        fill="${textColor}" 
        font-size="${fontSize}" 
        font-weight="${fontWeight}">${text}</text>
    `;
  }

  /**
   * Generate SVG for an input box
   * @param x X coordinate
   * @param y Y coordinate
   * @param width Width
   * @param height Height
   * @param props Properties
   * @returns SVG string
   */
  private static generateInputSVG(
    x: number,
    y: number,
    width: number,
    height: number,
    props: any
  ): string {
    const {
      backgroundColor,
      borderColor,
      borderWidth,
      placeholder,
      textColor,
    } = props;
    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" 
        rx="4" ry="4" 
        fill="${backgroundColor}" 
        stroke="${borderColor}" 
        stroke-width="${borderWidth}" />
      <text x="${x + 10}" y="${y + height / 2 + 5}" 
        fill="${textColor}" 
        font-size="14">${placeholder}</text>
    `;
  }

  /**
   * Generate SVG for an image
   * @param x X coordinate
   * @param y Y coordinate
   * @param width Width
   * @param height Height
   * @param props Properties
   * @returns SVG string
   */
  private static generateImageSVG(
    x: number,
    y: number,
    width: number,
    height: number,
    props: any
  ): string {
    const { imageUrl } = props;
    return `
      <image x="${x}" y="${y}" width="${width}" height="${height}" 
        href="${imageUrl}" />
    `;
  }

  /**
   * Generate SVG for a shape
   * @param x X coordinate
   * @param y Y coordinate
   * @param width Width
   * @param height Height
   * @param props Properties
   * @returns SVG string
   */
  private static generateShapeSVG(
    x: number,
    y: number,
    width: number,
    height: number,
    props: any
  ): string {
    const { shapeType, fillColor, borderColor, borderWidth } = props;
    let shapeSVG = '';

    switch (shapeType) {
      case 'rectangle':
        shapeSVG = `<rect x="${x}" y="${y}" width="${width}" height="${height}" 
          fill="${fillColor}" 
          stroke="${borderColor}" 
          stroke-width="${borderWidth}" />`;
        break;
      case 'circle':
        shapeSVG = `<circle cx="${x + width / 2}" cy="${y + height / 2}" r="${Math.min(width, height) / 2}" 
          fill="${fillColor}" 
          stroke="${borderColor}" 
          stroke-width="${borderWidth}" />`;
        break;
      case 'triangle':
        shapeSVG = `<polygon points="${x + width / 2},${y} ${x},${y + height} ${x + width},${y + height}" 
          fill="${fillColor}" 
          stroke="${borderColor}" 
          stroke-width="${borderWidth}" />`;
        break;
      default:
        break;
    }

    return shapeSVG;
  }

  /**
   * Generate SVG for a textbox
   * @param x X coordinate
   * @param y Y coordinate
   * @param width Width
   * @param height Height
   * @param props Properties
   * @returns SVG string
   */
  private static generateTextboxSVG(
    x: number,
    y: number,
    width: number,
    height: number,
    props: any
  ): string {
    const {
      text,
      backgroundColor,
      borderColor,
      borderWidth,
      textColor,
      padding,
      fontSize,
      fontWeight,
      textAlign,
    } = props;
    let textAnchor = 'start';
    if (textAlign === 'center') textAnchor = 'middle';
    if (textAlign === 'right') textAnchor = 'end';

    // Handle multi-line text
    const lines = text.split('\n');
    const lineHeight = fontSize * 1.5;
    let textSVG = '';

    lines.forEach((line: string, index: number) => {
      textSVG += `
        <text x="${x + padding}" y="${y + padding + (index + 1) * lineHeight}" 
          text-anchor="${textAnchor}" 
          fill="${textColor}" 
          font-size="${fontSize}" 
          font-weight="${fontWeight}">${line}</text>
      `;
    });

    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" 
        fill="${backgroundColor}" 
        stroke="${borderColor}" 
        stroke-width="${borderWidth}" />
      ${textSVG}
    `;
  }
}

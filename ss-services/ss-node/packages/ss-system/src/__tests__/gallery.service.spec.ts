// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GalleryService } from '../gallery/gallery.service';
import { PathResolverService } from '@ss-node/ss-core';

/**
 * GalleryService unit tests — pure-file approach
 *
 * Covered scenarios:
 *  1. Service initialization (auto-creates the gallery root directory)
 *  2. listFormats (format directory list + image counts)
 *  3. listCategories (category directory list + image counts)
 *  4. listImages (image file list + URLs + sizes)
 *  5. uploadImage (upload write + filename sanitization + extension validation)
 *  6. deleteImage (deletion)
 *  7. resolveImagePath (path resolution + traversal protection)
 */
describe('GalleryService', () => {
  let service: GalleryService;
  let tempDir: string;
  let imagesRoot: string;
  let mockConfigService: { get: jest.Mock };
  let mockPathResolver: { resolve: jest.Mock };

  beforeAll(() => {
    tempDir = path.join(
      os.tmpdir(),
      `gallery-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    imagesRoot = path.join(tempDir, 'images');
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    if (fs.existsSync(imagesRoot)) {
      fs.rmSync(imagesRoot, { recursive: true, force: true });
    }

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'DATA_DIR') return tempDir;
        if (key === 'IMAGES_DIR') return imagesRoot;
        return undefined;
      }),
    };

    mockPathResolver = {
      resolve: jest.fn((p: string) => path.resolve(p)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GalleryService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PathResolverService, useValue: mockPathResolver },
      ],
    }).compile();

    service = module.get<GalleryService>(GalleryService);
    await service.onModuleInit();
  });

  // ==================== 1. Initialization ====================

  describe('onModuleInit', () => {
    it('Should create the gallery root directory', () => {
      expect(fs.existsSync(imagesRoot)).toBe(true);
    });

    it('Should expose the correct gallery root directory path', () => {
      expect(service.getImagesRoot()).toBe(path.resolve(imagesRoot));
    });
  });

  // ==================== 2. listFormats ====================

  describe('listFormats', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(imagesRoot, '图元PNG'), { recursive: true });
      fs.mkdirSync(path.join(imagesRoot, '图元SVG'), { recursive: true });
      fs.writeFileSync(path.join(imagesRoot, '图元PNG', 'a.png'), 'x');
      fs.writeFileSync(path.join(imagesRoot, '图元PNG', 'b.png'), 'x');
    });

    it('Should return all format directories', async () => {
      const formats = await service.listFormats();
      const ids = formats.map((f) => f.id);
      expect(ids).toContain('图元PNG');
      expect(ids).toContain('图元SVG');
    });

    it('Should count images under the format directory', async () => {
      const formats = await service.listFormats();
      const png = formats.find((f) => f.id === '图元PNG');
      expect(png?.imageCount).toBe(2);
      const svg = formats.find((f) => f.id === '图元SVG');
      expect(svg?.imageCount).toBe(0);
    });

    it('Should ignore hidden directories', async () => {
      fs.mkdirSync(path.join(imagesRoot, '.hidden'), { recursive: true });
      const formats = await service.listFormats();
      expect(formats.map((f) => f.id)).not.toContain('.hidden');
    });
  });

  // ==================== 3. listCategories ====================

  describe('listCategories', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(imagesRoot, '图元PNG', 'Transportation'), { recursive: true });
      fs.mkdirSync(path.join(imagesRoot, '图元PNG', '开关'), { recursive: true });
      fs.writeFileSync(path.join(imagesRoot, '图元PNG', 'Transportation', '1.png'), 'x');
    });

    it('Should return category directories under the specified format', async () => {
      const categories = await service.listCategories('图元PNG');
      const names = categories.map((c) => c.name);
      expect(names).toContain('Transportation');
      expect(names).toContain('开关');
    });

    it('Should count images under the category directory', async () => {
      const categories = await service.listCategories('图元PNG');
      const traffic = categories.find((c) => c.name === 'Transportation');
      expect(traffic?.imageCount).toBe(1);
    });

    it('Should reject invalid format names', async () => {
      await expect(service.listCategories('../etc')).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== 4. listImages ====================

  describe('listImages', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(imagesRoot, '图元PNG', 'Transportation'), { recursive: true });
      fs.writeFileSync(path.join(imagesRoot, '图元PNG', 'Transportation', '1.png'), 'image-data');
      fs.writeFileSync(path.join(imagesRoot, '图元PNG', 'Transportation', 'not-image.txt'), 'txt');
    });

    it('Should return image files under the specified category (filtering non-image extensions)', async () => {
      const images = await service.listImages('图元PNG', 'Transportation');
      expect(images.length).toBe(1);
      expect(images[0].fileName).toBe('1.png');
    });

    it('Should return the access URL prefixed with /api/v1/gallery/image', async () => {
      const images = await service.listImages('图元PNG', 'Transportation');
      expect(images[0].url).toBe(
        '/api/v1/gallery/image?format=%E5%9B%BE%E5%85%83PNG&category=%E4%BA%A4%E9%80%9A&fileName=1.png',
      );
    });

    it('Should return the image size', async () => {
      const images = await service.listImages('图元PNG', 'Transportation');
      expect(images[0].size).toBe(Buffer.from('image-data').length);
    });

    it('Non-existent category should return an empty array', async () => {
      const images = await service.listImages('图元PNG', '不存在');
      expect(images).toEqual([]);
    });
  });

  // ==================== 5. uploadImage ====================

  describe('uploadImage', () => {
    it('Should write the image file and return the file name', async () => {
      const buffer = Buffer.from('fake-png');
      const fileName = await service.uploadImage(buffer, 'car.png', '图元PNG', 'Transportation');
      expect(fileName).toBe('car.png');
      const filePath = path.join(imagesRoot, '图元PNG', 'Transportation', 'car.png');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath)).toEqual(buffer);
    });

    it('Should sanitize the file name (removing path traversal characters)', async () => {
      const fileName = await service.uploadImage(
        Buffer.from('x'),
        '../../etc/passwd.png',
        '图元PNG',
        'Transportation',
      );
      expect(fileName).not.toContain('..');
      expect(fileName).toBe('passwd.png');
    });

    it('Should reject invalid extensions', async () => {
      await expect(
        service.uploadImage(Buffer.from('x'), 'evil.exe', '图元PNG', '交通'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Should reject an empty file name', async () => {
      await expect(
        service.uploadImage(Buffer.from('x'), '///', '图元PNG', '交通'),
      ).rejects.toThrow(BadRequestException);
    });

    it('Should reject invalid format names', async () => {
      await expect(
        service.uploadImage(Buffer.from('x'), 'a.png', '../etc', '交通'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== 6. deleteImage ====================

  describe('deleteImage', () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(imagesRoot, '图元PNG', 'Transportation'), { recursive: true });
      fs.writeFileSync(path.join(imagesRoot, '图元PNG', 'Transportation', '1.png'), 'x');
    });

    it('Should delete the specified image', async () => {
      await service.deleteImage('图元PNG', 'Transportation', '1.png');
      expect(fs.existsSync(path.join(imagesRoot, '图元PNG', 'Transportation', '1.png'))).toBe(false);
    });

    it('Should reject file names with path separators', async () => {
      await expect(service.deleteImage('图元PNG', '交通', '../1.png')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== 7. resolveImagePath path-traversal protection ====================

  describe('resolveImagePath', () => {
    it('Should resolve to an absolute path inside the gallery root', () => {
      const abs = service.resolveImagePath('图元PNG', 'Transportation', '1.png');
      expect(abs).toBe(path.join(imagesRoot, '图元PNG', 'Transportation', '1.png'));
    });

    it('Should reject file names containing ../', () => {
      expect(() => service.resolveImagePath('图元PNG', '交通', '../secret.png')).toThrow(
        BadRequestException,
      );
    });

    it('Should reject path separators in format names', () => {
      expect(() => service.resolveImagePath('../etc', '交通', '1.png')).toThrow(
        BadRequestException,
      );
    });

    it('Should reject traversal with category name ..', () => {
      expect(() => service.resolveImagePath('图元PNG', '..', '1.png')).toThrow(
        BadRequestException,
      );
    });

    it('Should reject absolute-path file names', () => {
      expect(() => service.resolveImagePath('图元PNG', '交通', '/etc/passwd')).toThrow(
        BadRequestException,
      );
    });
  });
});

// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import {
  Injectable,
  Inject,
  Optional,
  Logger,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Like, In, DeepPartial, FindOptionsWhere } from 'typeorm';
import { Device } from './entities/device.entity';
import { DataTag } from './entities/data-tag.entity';
import { DeviceGroup } from './entities/device-group.entity';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { CreateDataTagDto, UpdateDataTagDto, TagDataType } from '@ss-node/ss-datatag';
import { CreateDeviceGroupDto } from './dto/create-device-group.dto';
import { UpdateDeviceGroupDto } from './dto/update-device-group.dto';
import { QueryDeviceDto } from './dto/query-device.dto';
import { PaginatedResult } from '@ss-node/ss-sdk';
import { I18nService } from '@ss-node/ss-i18n';
import {
  DataPointCacheService,
  EventBusService,
  DeviceStateManager,
  ProjectDatabaseService,
  ErrorFactory,
  AuthorizationService,
} from '@ss-node/ss-core';
import { PluginRegistry } from '@ss-node/ss-collector-sdk';
import { ChannelConfigService } from './channel/channel-config.service';
import { TemplateLoaderService } from '@ss-node/ss-system';

/**
 * Minimal interface definition of TemplateLoaderService (for type safety).
 * ss-device now depends directly on @ss-node/ss-system (declared in package.json);
 * the circular dependency is handled via NestJS forwardRef, no more require() hack.
 */
interface ITemplateVariable {
  order: number;
  name: string;
  address: string;
  dataType: string;
  [key: string]: any; // allow all other TemplateVariable properties
}

interface ITemplate {
  id: string;
  name: string;
  deviceType: string;
  version: string;
  variables: ITemplateVariable[];
}

interface ITemplateLoaderService {
  getTemplate(templateId: string): ITemplate | undefined;
}

/** Project device-tree node (three levels: project -> group -> device) */
export interface ProjectDeviceTree {
  projectId: string;
  projectName: string;
  groups: DeviceTree[];
  /** Ungrouped devices (empty groupId), mounted under the project node */
  rootDevices: DeviceSummary[];
}

export interface DeviceTree {
  group: {
    id: string;
    name: string;
    sortOrder: number;
    parentId?: string;
  };
  children: DeviceTree[];
  devices: DeviceSummary[];
}

export interface DeviceSummary {
  id: string;
  deviceCode: string;
  deviceName: string;
  type: string;
  status: string;
}

/** Device statistics */
export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  connecting: number;
  degraded: number;
  error: number;
  totalTags: number;
}

/** Project-level Repository collection */
interface ProjectRepos {
  deviceRepo: Repository<Device>;
  dataTagRepo: Repository<DataTag>;
  deviceGroupRepo: Repository<DeviceGroup>;
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  /** Database mode: isolated=per-project DB, unified=global DB */
  private readonly dbMode: string;
  private readonly err: ErrorFactory;

  constructor(
    @Inject(getRepositoryToken(Device))
    private deviceRepository: Repository<Device>,
    @Inject(getRepositoryToken(DataTag))
    private dataTagRepository: Repository<DataTag>,
    @Inject(getRepositoryToken(DeviceGroup))
    private deviceGroupRepository: Repository<DeviceGroup>,
    @Inject(I18nService)
    private i18nService: I18nService,
    @Inject(ProjectDatabaseService)
    private projectDbService: ProjectDatabaseService,
    private configService: ConfigService,
    @Optional()
    @Inject(PluginRegistry)
    private pluginRegistry?: PluginRegistry,
    @Optional()
    @Inject(DataPointCacheService)
    private cacheService?: DataPointCacheService,
    @Optional()
    @Inject(ChannelConfigService)
    private channelConfigService?: ChannelConfigService,
    @Optional()
    @Inject(forwardRef(() => TemplateLoaderService))
    private templateLoaderService?: ITemplateLoaderService,
    @Optional()
    private readonly eventBus?: EventBusService,
    @Optional()
    @Inject(forwardRef(() => DeviceStateManager))
    private readonly deviceStateManager?: DeviceStateManager,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService?: AuthorizationService,
  ) {
    this.dbMode = this.configService.get<string>('PROJECT_DB_MODE', 'isolated');
    this.err = new ErrorFactory(this.i18nService);
    // Diagnostic log: confirm whether TemplateLoaderService was successfully injected
    if (this.templateLoaderService) {
      this.logger.log('TemplateLoaderService injected successfully — template binding is active');
    } else {
      this.logger.warn(
        'TemplateLoaderService NOT injected — template binding will be skipped! ' +
          'Check: @ss-node/ss-system dependency in ss-device/package.json and SystemModule import in DeviceModule',
      );
    }
  }

  /**
   * Get the Repository collection for a project by ID
   * - isolated mode: gets the project-level DataSource via ProjectDatabaseService
   * - unified mode: uses the globally injected Repository (backward-compatible behavior)
   */
  private async getRepos(projectId: string): Promise<ProjectRepos> {
    if (this.dbMode === 'isolated' && this.projectDbService) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      return {
        deviceRepo: ds.getRepository(Device),
        dataTagRepo: ds.getRepository(DataTag),
        deviceGroupRepo: ds.getRepository(DeviceGroup),
      };
    }
    return {
      deviceRepo: this.deviceRepository,
      dataTagRepo: this.dataTagRepository,
      deviceGroupRepo: this.deviceGroupRepository,
    };
  }

  async create(createDeviceDto: CreateDeviceDto, projectId: string): Promise<Device> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);

    // Check deviceCode uniqueness
    const existing = await deviceRepo.findOne({
      where: { deviceCode: createDeviceDto.deviceCode, projectId },
    });
    if (existing) {
      this.err.conflict('error.device.DEV_002', { deviceCode: createDeviceDto.deviceCode });
    }

    // Validate channel config (auto-injects the protocol field, avoiding the frontend passing it repeatedly)
    if (this.channelConfigService && createDeviceDto.connection) {
      const connection = { ...createDeviceDto.connection, protocol: createDeviceDto.driver };
      this.channelConfigService.validate(connection as any);
    }

    // Call the collection plugin's validateChannelConfig() for protocol-specific validation
    await this.validateWithPlugin(createDeviceDto.driver, createDeviceDto.connection);

    // Derive the device type from the template (per the prompt doc: choose a device template rather than picking a device type manually)
    let deviceType = 'modbus_tcp'; // default value
    let templateVersion: string | undefined;
    if (this.templateLoaderService && createDeviceDto.templateId) {
      const template = this.templateLoaderService.getTemplate(createDeviceDto.templateId);
      if (template) {
        deviceType = template.deviceType || deviceType;
        templateVersion = template.version;
        this.logger.log(
          `Device type derived from template ${createDeviceDto.templateId}: ${deviceType}`,
        );
      }
    }

    const device = deviceRepo.create({
      ...createDeviceDto,
      type: deviceType as any,
      projectId,
      templateVersion: createDeviceDto.templateVersion || templateVersion,
      templateAppliedAt: new Date(),
    });
    const saved = await deviceRepo.save(device);

    // Auto-instantiate template tags: create DataTags from template variables
    if (this.templateLoaderService && createDeviceDto.templateId) {
      const template = this.templateLoaderService.getTemplate(createDeviceDto.templateId);
      if (template && template.variables?.length) {
        const tagEntities = template.variables.map((v) =>
          dataTagRepo.create({
            name: v.name,
            description: (v as any).description,
            deviceId: saved.id,
            projectId,
            address: v.address,
            dataType: v.dataType as any,
            retryCount: (v as any).registerCount ?? (v as any).retryCount ?? 3,
            scanRate: (v as any).scanRate ?? 1000,
            timeout: (v as any).timeout ?? 5000,
            enabled: (v as any).enabled ?? true,
            scale: (v as any).scale,
            offset: (v as any).offset,
            conversionType: (v as any).conversionType as any,
            conversionConfig: (v as any).conversionConfig,
            unit: (v as any).unit,
            displayFormat: (v as any).displayFormat,
            minValue: (v as any).minValue,
            maxValue: (v as any).maxValue,
            deadbandMode: (v as any).deadbandMode as any,
            deadbandValue: (v as any).deadbandValue,
            deadbandPercent: (v as any).deadbandPercent,
            deadbandTime: (v as any).deadbandTime,
            alarmEnabled: (v as any).alarmEnabled ?? false,
            alarmHighHigh: (v as any).alarmHighHigh,
            alarmHigh: (v as any).alarmHigh,
            alarmLow: (v as any).alarmLow,
            alarmLowLow: (v as any).alarmLowLow,
            alarmDeviation: (v as any).alarmDeviation,
            qualityCheckEnabled: (v as any).qualityCheckEnabled ?? false,
            maxAge: (v as any).maxAge,
            archiveEnabled: (v as any).archiveEnabled ?? false,
            archiveInterval: (v as any).archiveInterval,
            archiveDeadband: (v as any).archiveDeadband,
          }),
        );
        await dataTagRepo.save(tagEntities);
        this.logger.log(
          `Template ${createDeviceDto.templateId} auto-applied to device ${saved.id}: ${tagEntities.length} tags created`,
        );
      }
    }

    // Notify the collection layer: device created; needs connection + collection-task registration
    this.eventBus?.emit('device.created', {
      deviceId: saved.id,
      projectId: saved.projectId,
      protocol: saved.driver || saved.type,
      connection: saved.connection,
      scanRate: saved.scanRate,
      templateId: saved.templateId,
      templateVersion: saved.templateVersion,
      timestamp: Date.now(),
    });

    this.logger.log(
      `Device created: ${saved.id} (${saved.deviceName}), protocol=${saved.driver || saved.type}`,
    );
    return saved;
  }

  async findAll(projectId: string, query?: QueryDeviceDto, roleId?: string): Promise<PaginatedResult<Device>> {
    const { deviceRepo } = await this.getRepos(projectId);
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const baseWhere: any = { projectId };

    // ───── Device-authorization filtering ─────
    if (roleId && this.authorizationService) {
      const accessibleIds = await this.authorizationService.getAccessibleDeviceIds(roleId, projectId);
      if (accessibleIds.length === 0) {
        // Role has no authorized devices in this project -> return an empty list
        return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
      }
      if (accessibleIds[0] !== '*') {
        baseWhere.id = In(accessibleIds);
      }
      // accessibleIds[0] === '*' -> no filter added, return everything
    }

    if (query?.deviceCode) {
      baseWhere.deviceCode = query.deviceCode;
    }
    if (query?.status && query.status !== 'all') {
      baseWhere.status = query.status;
    }
    if (query?.type) {
      baseWhere.type = query.type;
    }
    if (query?.groupId) {
      baseWhere.groupId = query.groupId;
    }

    let where: any;
    if (query?.search) {
      const searchStr = `%${query.search}%`;
      where = [
        { ...baseWhere, deviceName: Like(searchStr) },
        { ...baseWhere, deviceCode: Like(searchStr) },
        { ...baseWhere, nameAlias: Like(searchStr) },
      ];
    } else {
      where = baseWhere;
    }

    const order: any = {};
    if (query?.sortBy) {
      order[query.sortBy] = query.sortOrder || 'ASC';
    } else {
      order.createdAt = 'DESC';
    }

    const [data, total] = await deviceRepo.findAndCount({
      where,
      skip,
      take: pageSize,
      order,
    });

    // Merge the real-time state from DeviceStateManager's memory
    const merged = data.map((d) => this.mergeMemoryStatus(d));

    return {
      data: this.desensitizeDevices(merged),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get device statistics (total, per-status counts, total tags)
   * Used for the system-overview page's device-status distribution display
   */
  async getDeviceStats(projectId: string, roleId?: string): Promise<DeviceStats> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);

    // ───── Device-authorization filtering ─────
    const deviceWhere: any = { projectId };
    if (roleId && this.authorizationService) {
      const accessibleIds = await this.authorizationService.getAccessibleDeviceIds(roleId, projectId);
      if (accessibleIds.length === 0) {
        return { total: 0, online: 0, offline: 0, connecting: 0, degraded: 0, error: 0, totalTags: 0 };
      }
      if (accessibleIds[0] !== '*') {
        deviceWhere.id = In(accessibleIds);
      }
    }

    const devices = await deviceRepo.find({
      where: deviceWhere,
      select: ['id', 'status', 'lastDataAt', 'offlinePeriod'],
    });

    const total = devices.length;
    let online = 0;
    let offline = 0;
    let connecting = 0;
    let degraded = 0;
    let error = 0;

    const now = Date.now();
    for (const device of devices) {
      // Merge in-memory real-time state
      const memState = this.deviceStateManager?.getState(device.id);
      let status: string = memState ? memState.status : device.status;

      // Heartbeat-timeout fallback: even if status is marked online, if the last data time exceeds offlinePeriod, treat it as offline.
      // deviceStateManager may not be injected or not updated in time; use lastDataAt + offlinePeriod as a real-time fallback.
      if (status === 'online' && device.lastDataAt) {
        const offlineThreshold = device.offlinePeriod || 30000;
        if (now - device.lastDataAt.getTime() > offlineThreshold) {
          status = 'offline';
        }
      }

      switch (status) {
        case 'online':
          online++;
          break;
        case 'offline':
          offline++;
          break;
        case 'connecting':
          connecting++;
          break;
        case 'degraded':
          degraded++;
          break;
        case 'error':
          error++;
          break;
        default:
          offline++;
          break;
      }
    }

    const deviceIds = devices.map((d) => d.id);
    let tagCount = 0;
    if (deviceIds.length > 0) {
      tagCount = await dataTagRepo.count({
        where: { deviceId: In(deviceIds) },
      });
    }

    return { total, online, offline, connecting, degraded, error, totalTags: tagCount };
  }

  async findOne(id: string, projectId: string): Promise<Device> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);
    const device = await deviceRepo.findOne({
      where: { id, projectId },
    });
    if (!device) this.err.notFound('error.device.DEV_001', { id });
    // Query the device's associated data tags (template-instantiated + manually added)
    let tags = await dataTagRepo.find({ where: { deviceId: id } });

    // Auto-repair: if the device has a bound template but an empty tag table (possibly because a historical DI failure prevented instantiation),
    // automatically re-apply the template here. applyTemplate is idempotent (dedupes by name) and will not duplicate.
    if (device.templateId && (tags?.length ?? 0) === 0 && this.templateLoaderService) {
      this.logger.log(
        `Device ${id} has templateId "${device.templateId}" but 0 tags — auto-applying template to fix missing tags`,
      );
      try {
        await this.applyTemplate(id, device.templateId, projectId);
        // Reload tags
        tags = await dataTagRepo.find({ where: { deviceId: id } });
        this.logger.log(`Auto-apply completed: ${tags.length} tags now exist for device ${id}`);
      } catch (err: any) {
        this.logger.warn(
          `Auto-apply template failed for device ${id}: ${err.message}. Tags may need manual creation.`,
        );
      }
    }

    (device as any).tags = tags;
    // Merge in-memory real-time state + password desensitization
    return this.desensitizeDevice(this.mergeMemoryStatus(device));
  }

  /**
   * Override the DB-returned device status with DeviceStateManager's in-memory real-time state.
   * The frontend list display uses the in-memory state (updated by the latest collection callbacks).
   */
  private mergeMemoryStatus(device: Device): Device {
    const memoryState = this.deviceStateManager?.getState(device.id);
    if (memoryState) {
      device.status = memoryState.status as any;
      if (memoryState.lastOnlineAt) {
        device.lastOnlineAt = new Date(memoryState.lastOnlineAt) as any;
      }
      if (memoryState.lastOfflineAt) {
        device.lastOfflineAt = new Date(memoryState.lastOfflineAt) as any;
      }
      if (memoryState.lastDataAt) {
        device.lastDataAt = new Date(memoryState.lastDataAt) as any;
      }
      // Merge runtime error info
      if (memoryState.lastErrorMessage) {
        (device as any).lastErrorMsg = memoryState.lastErrorMessage;
      }
      // Merge the runtime error count: the number of failingTags
      const failingCount = memoryState.failingTags?.length ?? 0;
      (device as any).errorCount = failingCount;
      // Merge collection diagnostics
      if (memoryState.diagnostics) {
        (device as any)._diagnostics = {
          retryCount: memoryState.diagnostics.retryCount,
          circuitState: memoryState.diagnostics.circuitState,
          consecutiveFailures: memoryState.diagnostics.consecutiveFailures,
          lastErrorAt: memoryState.diagnostics.lastErrorAt,
        };
      }
    }
    return device;
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto, projectId: string): Promise<Device> {
    const { deviceRepo } = await this.getRepos(projectId);
    const device = await this.findOne(id, projectId);
    if (updateDeviceDto.deviceCode && updateDeviceDto.deviceCode !== device.deviceCode) {
      const existing = await deviceRepo.findOne({
        where: { deviceCode: updateDeviceDto.deviceCode, projectId },
      });
      if (existing) {
        this.err.conflict('error.device.DEV_002', { deviceCode: updateDeviceDto.deviceCode });
      }
    }

    // When the connection config is updated, call the plugin validation interface
    if (updateDeviceDto.connection) {
      await this.validateWithPlugin(device.driver, updateDeviceDto.connection);
    }

    // Detect changed fields (for notifying the collection layer to perform incremental operations)
    const changedFields: string[] = [];
    const changes: Record<string, { old: any; new: any }> = {};
    if (
      updateDeviceDto.connection &&
      JSON.stringify(updateDeviceDto.connection) !== JSON.stringify(device.connection)
    ) {
      changedFields.push('connection');
      changes.connection = { old: device.connection, new: updateDeviceDto.connection };
    }
    if (updateDeviceDto.scanRate !== undefined && updateDeviceDto.scanRate !== device.scanRate) {
      changedFields.push('scanRate');
      changes.scanRate = { old: device.scanRate, new: updateDeviceDto.scanRate };
    }
    if (
      updateDeviceDto.deviceName !== undefined &&
      updateDeviceDto.deviceName !== device.deviceName
    ) {
      changedFields.push('deviceName');
      changes.deviceName = { old: device.deviceName, new: updateDeviceDto.deviceName };
    }
    if (updateDeviceDto.groupId !== undefined && updateDeviceDto.groupId !== device.groupId) {
      changedFields.push('groupId');
      changes.groupId = { old: device.groupId, new: updateDeviceDto.groupId };
    }

    // Detect whether templateId changed: editing the device binding / switching templates requires instantiating the tag table
    const oldTemplateId = device.templateId ?? null;
    const newTemplateId = updateDeviceDto.templateId ?? null;
    const templateChanged = newTemplateId !== oldTemplateId;
    if (templateChanged) {
      changedFields.push('tags');
      changes.tags = { old: oldTemplateId, new: newTemplateId };
    }
    // Detect whether the collection driver changed
    if (updateDeviceDto.driver && updateDeviceDto.driver !== device.driver) {
      changedFields.push('driver');
      changes.driver = { old: device.driver, new: updateDeviceDto.driver };
    }
    // Fix a historical issue: if the template did not change but the device has no tag table (possibly from an earlier DI failure), also re-apply
    const effectiveTemplateId = newTemplateId ?? oldTemplateId;
    const needsReapply =
      !templateChanged && effectiveTemplateId && ((device as any).tags?.length ?? 0) === 0;

    Object.assign(device, updateDeviceDto);
    const saved = await deviceRepo.save(device);

    // Instantiate tags on template change (same auto-instantiation logic as device creation)
    if (templateChanged && newTemplateId) {
      this.logger.log(
        `Template changed for device ${saved.id}: ${oldTemplateId || '(none)'} → ${newTemplateId}, applying template...`,
      );
      await this.applyTemplate(saved.id, newTemplateId, projectId);
    }

    // Template unchanged but the tag table is empty; re-apply the template to fix the historical issue
    if (needsReapply) {
      this.logger.log(
        `Template unchanged for device ${saved.id} but 0 tags found — re-applying template ${effectiveTemplateId} to fix missing tags`,
      );
      await this.applyTemplate(saved.id, effectiveTemplateId!, projectId);
    }

    // Notify the collection layer: device config changed (channel/frequency/driver/status etc.)
    if (changedFields.length > 0) {
      this.eventBus?.emit('device.updated', {
        deviceId: saved.id,
        projectId: saved.projectId,
        protocol: saved.driver || saved.type,
        changedFields,
        connection: changedFields.includes('connection') ? saved.connection : undefined,
        scanRate: changedFields.includes('scanRate') ? saved.scanRate : undefined,
        offlinePeriod: changedFields.includes('offlinePeriod') ? saved.offlinePeriod : undefined,
        driver: changedFields.includes('driver') ? saved.driver : undefined,
        changes,
        timestamp: Date.now(),
      });

      this.logger.log(
        `Device updated: ${saved.id} (${saved.deviceName}), changed: ${changedFields.join(', ')}`,
      );
    }

    return this.findOne(saved.id, projectId);
  }

  async remove(id: string, projectId: string): Promise<void> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);
    const device = await this.findOne(id, projectId);

    // 1. Delete all data tags associated with the device (clean up FK dependencies first)
    const tags = await dataTagRepo.find({ where: { deviceId: id } });
    if (tags.length > 0) {
      const tagIds = tags.map((t) => t.id);
      if (this.dbMode === 'isolated' && this.projectDbService) {
        const ds = await this.projectDbService.getSystemDb(projectId);
        await ds.query(
          `DELETE FROM alm_alarm_rules WHERE tagId IN (${tagIds.map(() => '?').join(',')})`,
          tagIds,
        );
        await ds.query(
          `DELETE FROM data_historical_data WHERE tagId IN (${tagIds.map(() => '?').join(',')})`,
          tagIds,
        );
      }
      await dataTagRepo.remove(tags);
      this.logger.log(`Cascade deleted ${tags.length} tags for device ${id}`);
    }

    // 2. Delete the device (SQLite FK cascade: dev_device_status_log, dev_device_group_members)
    await deviceRepo.remove(device);

    // 3. Notify the collection layer: device deleted; needs disconnect + collection-task unregistration
    this.eventBus?.emit('device.deleted', {
      deviceId: id,
      projectId,
      protocol: device.driver || device.type,
      timestamp: Date.now(),
    });

    this.logger.log(`Device ${id} (${device.deviceName}) deleted with cascade`);
  }

  async addTag(
    deviceId: string,
    createDataTagDto: CreateDataTagDto,
    projectId: string,
  ): Promise<DataTag> {
    const { dataTagRepo } = await this.getRepos(projectId);
    await this.findOne(deviceId, projectId);
    const tag = dataTagRepo.create({
      ...createDataTagDto,
      deviceId,
    } as unknown as DeepPartial<DataTag>);
    return dataTagRepo.save(tag);
  }

  async addTags(deviceId: string, dtos: CreateDataTagDto[], projectId: string): Promise<DataTag[]> {
    const { dataTagRepo } = await this.getRepos(projectId);
    await this.findOne(deviceId, projectId);
    const tags = dtos.map((dto) =>
      dataTagRepo.create({
        ...dto,
        deviceId,
      } as unknown as DeepPartial<DataTag>),
    );
    return dataTagRepo.save(tags);
  }

  async removeTag(tagId: string, deviceId: string, projectId: string): Promise<void> {
    const { dataTagRepo } = await this.getRepos(projectId);
    await this.findOne(deviceId, projectId);
    const tag = await dataTagRepo.findOne({ where: { id: tagId, deviceId } });
    if (!tag) this.err.notFound('error.data.DATA_005', { tagId });
    // Clean up FK-dependent records first
    if (this.dbMode === 'isolated' && this.projectDbService) {
      const ds = await this.projectDbService.getSystemDb(projectId);
      await ds.query('DELETE FROM alm_alarm_rules WHERE tagId = ?', [tagId]);
      await ds.query('DELETE FROM data_historical_data WHERE tagId = ?', [tagId]);
    }
    await dataTagRepo.remove(tag);
  }

  async updateDataTag(
    tagId: string,
    deviceId: string,
    updateDataTagDto: UpdateDataTagDto,
    projectId: string,
  ): Promise<DataTag> {
    const { dataTagRepo } = await this.getRepos(projectId);
    await this.findOne(deviceId, projectId);
    const tag = await dataTagRepo.findOne({ where: { id: tagId, deviceId } });
    if (!tag) this.err.notFound('error.data.DATA_005', { tagId });
    Object.assign(tag, updateDataTagDto);
    return dataTagRepo.save(tag);
  }

  async createGroup(dto: CreateDeviceGroupDto, projectId: string): Promise<DeviceGroup> {
    const { deviceGroupRepo } = await this.getRepos(projectId);
    const group = deviceGroupRepo.create({ ...dto, projectId });
    return deviceGroupRepo.save(group);
  }

  async findAllGroups(projectId: string): Promise<DeviceGroup[]> {
    const { deviceGroupRepo } = await this.getRepos(projectId);
    return deviceGroupRepo.find({
      where: { projectId },
      order: { sortOrder: 'ASC' },
    });
  }

  async findOneGroup(id: string, projectId: string): Promise<DeviceGroup> {
    const { deviceGroupRepo } = await this.getRepos(projectId);
    const group = await deviceGroupRepo.findOne({
      where: { id, projectId },
      relations: ['children'],
    });
    if (!group) this.err.notFound('error.device.DEV_001', { id });
    return group;
  }

  async updateGroup(
    id: string,
    dto: UpdateDeviceGroupDto,
    projectId: string,
  ): Promise<DeviceGroup> {
    const { deviceGroupRepo } = await this.getRepos(projectId);
    const group = await this.findOneGroup(id, projectId);
    Object.assign(group, dto);
    return deviceGroupRepo.save(group);
  }

  async removeGroup(id: string, projectId: string): Promise<void> {
    const { deviceGroupRepo } = await this.getRepos(projectId);
    const group = await this.findOneGroup(id, projectId);

    if (group.children?.length) {
      for (const child of group.children) {
        child.parentId = group.parentId || null;
        await deviceGroupRepo.save(child);
      }
    }

    await deviceGroupRepo.remove(group);
  }

  /**
   * Move a device to a target group (supports moving across multi-level groups)
   * @param deviceId device ID
   * @param targetGroupId target group ID; null means moving out of any group (ungrouped)
   * @param projectId project ID
   */
  async moveDevice(
    deviceId: string,
    targetGroupId: string | null,
    projectId: string,
  ): Promise<Device> {
    const { deviceRepo, deviceGroupRepo } = await this.getRepos(projectId);
    const device = await this.findOne(deviceId, projectId);

    // Validate that the target group exists and belongs to the current project
    if (targetGroupId) {
      const targetGroup = await deviceGroupRepo.findOne({
        where: { id: targetGroupId, projectId },
      });
      if (!targetGroup) {
        this.err.notFound('error.device.DEV_001', { id: targetGroupId });
      }
    }

    const oldGroupId = device.groupId;
    // The groupId entity type is string, but the column allows null; when targetGroupId is null, TypeORM stores null
    device.groupId = targetGroupId as string;
    const saved = await deviceRepo.save(device);

    // Notify the collection layer: device group changed
    this.eventBus?.emit('device.updated', {
      deviceId: saved.id,
      projectId: saved.projectId,
      protocol: saved.driver || saved.type,
      changedFields: ['groupId'],
      changes: { groupId: { old: oldGroupId, new: targetGroupId } },
      timestamp: Date.now(),
    });

    this.logger.log(
      `Device ${saved.id} moved to group ${targetGroupId || '(none)'} (was ${oldGroupId || '(none)'})`,
    );
    return saved;
  }

  /**
   * Get a group's full path (from root to the current group)
   * Walks up the parentId chain, with cycle detection to prevent infinite loops
   * @param groupId group ID
   * @param projectId project ID
   * @returns path array; index 0 is the root group, the last is the current group
   */
  async getGroupPath(groupId: string, projectId: string): Promise<DeviceGroup[]> {
    const { deviceGroupRepo } = await this.getRepos(projectId);

    const path: DeviceGroup[] = [];
    const visited = new Set<string>();
    let currentId: string | null = groupId;

    while (currentId) {
      // Cycle detection: abort traversal if this node was already visited
      if (visited.has(currentId)) {
        this.logger.warn(
          `Cycle detected in group path at groupId=${currentId}, aborting path traversal`,
        );
        break;
      }
      visited.add(currentId);

      const group = await deviceGroupRepo.findOne({
        where: { id: currentId, projectId },
      });
      if (!group) break;

      path.unshift(group); // insert at the head; final order is root to current
      currentId = group.parentId;
    }

    return path;
  }

  /**
   * Get the device-group tree (three levels: project -> group -> device)
   * Per the prompt doc requirement #4: the device tree displays project -> group -> device, three levels
   */
  async getGroupTree(projectId: string, projectName?: string, roleId?: string): Promise<ProjectDeviceTree> {
    const { deviceGroupRepo, deviceRepo } = await this.getRepos(projectId);

    const groups = await deviceGroupRepo.find({
      where: { projectId },
      relations: ['children'],
      order: { sortOrder: 'ASC' },
    });

    // ───── Device-authorization filtering ─────
    let authorizedDeviceIds: string[] | null = null;
    if (roleId && this.authorizationService) {
      const accessibleIds = await this.authorizationService.getAccessibleDeviceIds(roleId, projectId);
      if (accessibleIds.length > 0 && accessibleIds[0] !== '*') {
        authorizedDeviceIds = accessibleIds;
      }
    }

    const devices = await deviceRepo.find({
      where: {
        projectId,
        ...(authorizedDeviceIds ? { id: In(authorizedDeviceIds) } : {}),
      },
      select: ['id', 'deviceCode', 'deviceName', 'type', 'status', 'groupId'],
    });

    const deviceMap = new Map<string, DeviceSummary[]>();
    const rootDevices: DeviceSummary[] = [];
    for (const device of devices) {
      // Merge in-memory real-time state
      const memState = this.deviceStateManager?.getState(device.id);
      const displayStatus = memState ? memState.status : device.status;

      const summary: DeviceSummary = {
        id: device.id,
        deviceCode: device.deviceCode,
        deviceName: device.deviceName,
        type: device.type,
        status: displayStatus,
      };

      const key = device.groupId;
      if (!key) {
        // Ungrouped devices mount at the project root
        rootDevices.push(summary);
      } else {
        if (!deviceMap.has(key)) deviceMap.set(key, []);
        deviceMap.get(key)!.push(summary);
      }
    }

    const rootGroups = groups.filter((g) => !g.parentId);
    const groupTree = rootGroups.map((g) => this.buildTreeNode(g, groups, deviceMap));

    return {
      projectId,
      projectName: projectName || projectId,
      groups: groupTree,
      rootDevices,
    };
  }

  /**
   * Password desensitization: mask sensitive fields in the device connection config
   * Applies to password protection in findAll list scenarios
   */
  desensitizeDevices(devices: Device[]): Device[] {
    return devices.map((d) => this.desensitizeDevice(d));
  }

  /**
   * Call the collection plugin's validateChannelConfig() for protocol-specific semantic validation
   */
  private async validateWithPlugin(driver: string, connection: Record<string, any>): Promise<void> {
    if (!this.pluginRegistry || !connection) return;

    try {
      const adapter = this.pluginRegistry.getAdapter(driver);
      if (!adapter) {
        this.logger.warn(`No adapter found for driver ${driver}, skipping plugin validation`);
        return;
      }
      const result = await adapter.validateChannelConfig(connection);
      if (!result.valid) {
        throw new BadRequestException({
          code: 'CH_007',
          message: '采集插件通道配置校验失败',
          errors: result.errors,
        });
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.warn(`Plugin validation error for driver ${driver}: ${(error as Error).message}`);
    }
  }

  private desensitizeDevice(device: Device): Device {
    if (!device.connection || typeof device.connection !== 'object') {
      return device;
    }

    const SENSITIVE_KEYS = ['password', 'privatekeypath', 'certificatepath', 'keypath', 'capath'];
    const connection = { ...device.connection };

    const maskSensitive = (obj: Record<string, any>) => {
      for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk))) {
          if (typeof obj[key] === 'string' && obj[key].length > 0) {
            obj[key] = '***';
          }
        } else if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          maskSensitive(obj[key]);
        }
      }
    };

    maskSensitive(connection);
    return { ...device, connection };
  }

  private buildTreeNode(
    group: DeviceGroup,
    allGroups: DeviceGroup[],
    deviceMap: Map<string, DeviceSummary[]>,
  ): DeviceTree {
    const children = allGroups
      .filter((g) => g.parentId === group.id)
      .map((g) => this.buildTreeNode(g, allGroups, deviceMap));

    return {
      group: {
        id: group.id,
        name: group.name,
        sortOrder: group.sortOrder,
        parentId: group.parentId || undefined,
      },
      children,
      devices: deviceMap.get(group.id) || [],
    };
  }

  async searchTags(
    projectId: string,
    query?: string,
    tagType?: string,
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<DataTag>> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);
    const devices = await deviceRepo.find({
      where: { projectId },
      select: ['id'],
    });
    const deviceIds = devices.map((d) => d.id);

    if (deviceIds.length === 0) {
      return { data: [], pagination: { page, pageSize, total: 0, totalPages: 0 } };
    }

    const where: any = { deviceId: In(deviceIds), enabled: true };

    if (query) {
      where.name = Like(`%${query}%`);
    }

    if (tagType) {
      where.dataType = tagType;
    }

    const skip = (page - 1) * pageSize;
    const [data, total] = await dataTagRepo.findAndCount({
      where,
      relations: ['device'],
      skip,
      take: pageSize,
      order: { name: 'ASC' },
    });

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * Query a device's data-tag list ("the single authoritative entry shared by the admin and mobile ends",
   * see architecture doc 07 API design spec sections 3.3 / 4.1).
   * - Validates the device exists in the project (throws DEV_001 otherwise)
   * - Filters by deviceId; supports keyword (fuzzy on name), dataType, and enabled filters
   * - Returns paginated { data, pagination } (unified structure with ss-device / ss-datatag findAll)
   */
  async findTagsByDevice(
    projectId: string,
    deviceId: string,
    query: { page?: number; pageSize?: number; keyword?: string; dataType?: string; enabled?: boolean } = {},
  ): Promise<PaginatedResult<DataTag>> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);
    // Validate device existence (reusing findOne's existence check, but without the auto-apply side effect)
    const device = await deviceRepo.findOne({ where: { id: deviceId, projectId }, select: ['id'] });
    if (!device) this.err.notFound('error.device.DEV_001', { id: deviceId });

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: FindOptionsWhere<DataTag> = { deviceId };
    if (query.keyword) {
      where.name = Like(`%${query.keyword}%`);
    }
    if (query.dataType) {
      const dataType = Object.values(TagDataType).find((v) => v === query.dataType);
      if (dataType) where.dataType = dataType;
    }
    if (query.enabled !== undefined && query.enabled !== null) {
      where.enabled = query.enabled;
    }

    const skip = (page - 1) * pageSize;
    const [data, total] = await dataTagRepo.findAndCount({
      where,
      skip,
      take: pageSize,
      order: { name: 'ASC' },
    });

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async batchGetLatest(
    projectId: string,
    tagIds: string[],
  ): Promise<Record<string, { value: any; quality: string; timestamp: number }>> {
    const result: Record<string, { value: any; quality: string; timestamp: number }> = {};

    if (this.cacheService) {
      const cached = await this.cacheService.getMany(tagIds);
      cached.forEach((entry, tagId) => {
        result[tagId] = {
          value: entry.value,
          quality: entry.quality,
          timestamp: entry.timestamp,
        };
      });
    }

    for (const tagId of tagIds) {
      if (!result[tagId]) {
        result[tagId] = { value: null, quality: 'unknown', timestamp: Date.now() };
      }
    }

    return result;
  }

  /**
   * Apply a device template: load variable definitions from the template and instantiate DataTags
   * Per the prompt doc requirement #1: adding a device requires selecting a device template
   */
  async applyTemplate(deviceId: string, templateId: string, projectId: string): Promise<DataTag[]> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);
    // Use deviceRepo.findOne rather than this.findOne, avoiding infinite recursion with findOne's auto-repair logic
    const device = await deviceRepo.findOne({ where: { id: deviceId, projectId } });
    if (!device) {
      this.err.notFound('error.device.DEV_001', { id: deviceId });
    }

    let createdTags: DataTag[] = [];

    if (this.templateLoaderService) {
      const template = this.templateLoaderService.getTemplate(templateId);
      if (!template) {
        this.logger.warn(
          `Template ${templateId} not found in loader cache, applying templateId only. ` +
            `Available templates may not include this ID.`,
        );
      } else if (!template.variables || template.variables.length === 0) {
        this.logger.warn(
          `Template ${templateId} found but has no variables — no tags will be created`,
        );
      } else {
        // Check existing tags to avoid duplicate creation
        const existingTags = await dataTagRepo.find({ where: { deviceId } });
        const existingNames = new Set(existingTags.map((t) => t.name));

        // Filter out already-existing tags (same-name tags count as instantiated)
        const newVariables = template.variables.filter((v) => !existingNames.has(v.name));
        const skippedCount = template.variables.length - newVariables.length;

        if (newVariables.length > 0) {
          const tagEntities = newVariables.map((v) =>
            dataTagRepo.create({
              name: v.name,
              description: v.description,
              deviceId,
              projectId,
              address: v.address,
              dataType: v.dataType as any,
              retryCount: v.registerCount ?? v.retryCount,
              scanRate: v.scanRate,
              timeout: v.timeout,
              enabled: v.enabled,
              scale: v.scale,
              offset: v.offset,
              decimalPlaces: v.decimalPlaces,
              engMinValue: v.engMinValue,
              engMaxValue: v.engMaxValue,
              conversionType: v.conversionType as any,
              conversionConfig: v.conversionConfig,
              unit: v.unit,
              displayFormat: v.displayFormat,
              minValue: v.minValue,
              maxValue: v.maxValue,
              deadbandMode: v.deadbandMode as any,
              deadbandValue: v.deadbandValue,
              deadbandPercent: v.deadbandPercent,
              deadbandTime: v.deadbandTime,
              alarmEnabled: v.alarmEnabled,
              alarmHighHigh: v.alarmHighHigh,
              alarmHigh: v.alarmHigh,
              alarmLow: v.alarmLow,
              alarmLowLow: v.alarmLowLow,
              alarmDeviation: v.alarmDeviation,
              qualityCheckEnabled: v.qualityCheckEnabled,
              maxAge: v.maxAge,
              archiveEnabled: v.archiveEnabled,
              archiveInterval: v.archiveInterval,
              retentionDays: v.retentionDays,
              category: v.category,
              tags: v.tags,
              direction: v.direction,
              templateVariableGuid: (v as any).guid,
            }),
          );
          createdTags = await dataTagRepo.save(tagEntities);
        }
        this.logger.log(
          `Template ${templateId} applied to device ${deviceId}: ${createdTags.length} created, ${skippedCount} skipped (already exist)`,
        );
      }
    } else {
      this.logger.warn(`TemplateLoaderService not available, templateId saved only`);
    }

    device.templateId = templateId;
    device.templateVersion = this.templateLoaderService?.getTemplate(templateId)?.version;
    device.templateAppliedAt = new Date();
    await deviceRepo.save(device);

    // Notify the collection layer: device tags changed
    if (createdTags.length > 0) {
      this.eventBus?.emit('device.updated', {
        deviceId,
        projectId,
        protocol: device.driver || device.type,
        changedFields: ['tags'],
        changes: {
          tags: { old: '(reloaded)', new: `template: ${templateId} v${device.templateVersion}` },
        },
        timestamp: Date.now(),
      });
    }

    return createdTags;
  }

  async syncTemplateTags(
    deviceId: string,
    templateId: string,
    projectId: string,
  ): Promise<{ updated: number; added: number; removed: number }> {
    const { dataTagRepo } = await this.getRepos(projectId);
    const device = await this.findOne(deviceId, projectId);

    if (!this.templateLoaderService) {
      this.logger.warn(`TemplateLoaderService not available, sync skipped`);
      return { updated: 0, added: 0, removed: 0 };
    }

    const template = this.templateLoaderService.getTemplate(templateId);
    if (!template) {
      this.logger.warn(`Template ${templateId} not found, sync skipped`);
      return { updated: 0, added: 0, removed: 0 };
    }

    const existingTags = await dataTagRepo.find({ where: { deviceId } });
    const existingNameMap = new Map(existingTags.map((t) => [t.name, t]));

    let updated = 0;
    let added = 0;
    let removed = 0;

    // Update existing tags or add new ones
    for (const v of template.variables) {
      const existing = existingNameMap.get(v.name);
      if (existing) {
        existingNameMap.delete(v.name);
        Object.assign(existing, {
          description: v.description,
          address: v.address,
          dataType: v.dataType,
          retryCount: v.registerCount ?? v.retryCount,
          scanRate: v.scanRate,
          timeout: v.timeout,
          enabled: v.enabled,
          scale: v.scale,
          offset: v.offset,
          decimalPlaces: v.decimalPlaces,
          displayFormat: v.displayFormat,
          unit: v.unit,
          minValue: v.minValue,
          maxValue: v.maxValue,
          engMinValue: v.engMinValue,
          engMaxValue: v.engMaxValue,
          deadbandMode: v.deadbandMode,
          deadbandValue: v.deadbandValue,
          deadbandPercent: v.deadbandPercent,
          deadbandTime: v.deadbandTime,
          conversionType: v.conversionType,
          conversionConfig: v.conversionConfig,
          alarmEnabled: v.alarmEnabled,
          alarmHighHigh: v.alarmHighHigh,
          alarmHigh: v.alarmHigh,
          alarmLow: v.alarmLow,
          alarmLowLow: v.alarmLowLow,
          alarmDeviation: v.alarmDeviation,
          qualityCheckEnabled: v.qualityCheckEnabled,
          maxAge: v.maxAge,
          archiveEnabled: v.archiveEnabled,
          archiveInterval: v.archiveInterval,
          retentionDays: v.retentionDays,
          category: v.category,
          tags: v.tags,
          direction: v.direction,
          templateVariableGuid: (v as any).guid,
        });
        await dataTagRepo.save(existing);
        updated++;
      } else {
        const newTag = dataTagRepo.create({
          name: v.name,
          description: v.description,
          deviceId,
          projectId,
          address: v.address,
          dataType: v.dataType as any,
          retryCount: v.registerCount ?? v.retryCount,
          scanRate: v.scanRate,
          timeout: v.timeout,
          enabled: v.enabled,
          scale: v.scale,
          offset: v.offset,
          decimalPlaces: v.decimalPlaces,
          displayFormat: v.displayFormat,
          unit: v.unit,
          minValue: v.minValue,
          maxValue: v.maxValue,
          engMinValue: v.engMinValue,
          engMaxValue: v.engMaxValue,
          deadbandMode: v.deadbandMode as any,
          deadbandValue: v.deadbandValue,
          deadbandPercent: v.deadbandPercent,
          deadbandTime: v.deadbandTime,
          conversionType: v.conversionType as any,
          conversionConfig: v.conversionConfig,
          alarmEnabled: v.alarmEnabled,
          alarmHighHigh: v.alarmHighHigh,
          alarmHigh: v.alarmHigh,
          alarmLow: v.alarmLow,
          alarmLowLow: v.alarmLowLow,
          alarmDeviation: v.alarmDeviation,
          qualityCheckEnabled: v.qualityCheckEnabled,
          maxAge: v.maxAge,
          archiveEnabled: v.archiveEnabled,
          archiveInterval: v.archiveInterval,
          retentionDays: v.retentionDays,
          category: v.category,
          tags: v.tags,
          direction: v.direction,
          templateVariableGuid: (v as any).guid,
        });
        await dataTagRepo.save(newTag);
        added++;
      }
    }

    // Delete tags no longer present in the template (clean up FK-dependent records first)
    if (existingNameMap.size > 0) {
      const staleTagIds = Array.from(existingNameMap.values()).map((t) => t.id);
      if (this.dbMode === 'isolated' && this.projectDbService) {
        const ds = await this.projectDbService.getSystemDb(projectId);
        // Delete associated alarm rules (alm_alarm_rules.tagId FK -> dev_data_tags.id)
        await ds.query(
          `DELETE FROM alm_alarm_rules WHERE tagId IN (${staleTagIds.map(() => '?').join(',')})`,
          staleTagIds,
        );
        // Clean up associated historical data (data_historical_data.tagId FK -> dev_data_tags.id)
        await ds.query(
          `DELETE FROM data_historical_data WHERE tagId IN (${staleTagIds.map(() => '?').join(',')})`,
          staleTagIds,
        );
      }
      for (const [, tag] of existingNameMap) {
        await dataTagRepo.remove(tag);
        removed++;
      }
    }

    device.templateVersion = template.version;
    device.templateAppliedAt = new Date();
    const { deviceRepo } = await this.getRepos(projectId);
    await deviceRepo.save(device);

    this.logger.log(
      `Template sync for device ${deviceId}: updated=${updated}, added=${added}, removed=${removed}`,
    );
    return { updated, added, removed };
  }

  /**
   * Unbind a device template: clears templateId/templateVersion/templateAppliedAt
   * @param deleteTags whether to delete tags generated by the template (default false, keeping instantiated tags)
   */
  async unbindTemplate(
    deviceId: string,
    projectId: string,
    deleteTags = false,
  ): Promise<{ templateId: string | null; tagsDeleted: number }> {
    const { deviceRepo, dataTagRepo } = await this.getRepos(projectId);
    const device = await this.findOne(deviceId, projectId);

    if (!device.templateId) {
      this.err.badRequest('error.device.DEV_001', { id: deviceId });
    }

    const previousTemplateId = device.templateId;
    let tagsDeleted = 0;

    if (deleteTags) {
      const tags = await dataTagRepo.find({ where: { deviceId } });
      if (tags.length > 0) {
        await dataTagRepo.remove(tags);
        tagsDeleted = tags.length;
      }
    }

    device.templateId = null as any;
    device.templateVersion = null as any;
    device.templateAppliedAt = null as any;
    await deviceRepo.save(device);

    this.logger.log(
      `Template unbound for device ${deviceId}: templateId=${previousTemplateId}, tagsDeleted=${tagsDeleted}`,
    );

    return { templateId: previousTemplateId, tagsDeleted };
  }
}

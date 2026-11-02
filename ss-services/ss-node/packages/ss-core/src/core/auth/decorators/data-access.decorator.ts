// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { SetMetadata } from '@nestjs/common';

export const DATA_ACCESS_KEY = 'data_access';

/**
 * Data-access decorator
 *
 * Declares the resource type an endpoint needs to check, used together with DataAccessGuard.
 *
 * Usage:
 *   @DataAccess('project')     - check the user's access to the projectId param
 *   @DataAccess('device')      - check the user's access to the deviceId param
 *   @DataAccess('deviceGroup') - check the user's access to the groupId param
 */
export const DataAccess = (...resources: string[]) => SetMetadata(DATA_ACCESS_KEY, resources);

// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { UnauthorizedException } from '@nestjs/common';
import { PreviewTicketService } from '../preview-ticket.service';
import { AuthService } from '../../auth.service';
import { UserService } from '../../../user/user.service';
import { User } from '../../../user/entities/user.entity';

// Mock dependencies (consistent with the existing hand-written mock style in the auth domain)
const mockAuthService = {
  generateTokensForUser: jest.fn(),
};

const mockUserService = {
  findById: jest.fn(),
};

const TOKEN_PAIR = { accessToken: 'access-token', refreshToken: 'refresh-token' };

function buildUser(overrides?: Partial<User>): User {
  return {
    id: 'user-1',
    username: 'operator',
    role: 'user',
    ...overrides,
  } as User;
}

describe('PreviewTicketService', () => {
  let service: PreviewTicketService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockAuthService.generateTokensForUser.mockResolvedValue(TOKEN_PAIR);
    mockUserService.findById.mockResolvedValue(buildUser());
    service = new PreviewTicketService(
      mockAuthService as unknown as AuthService,
      mockUserService as unknown as UserService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Issued tickets can be redeemed for a token pair (user identity taken from the userId bound at issuance)', async () => {
    const previewTicket = service.issuePreviewTicket('user-1');

    const tokenPair = await service.consumePreviewTicket(previewTicket);

    expect(tokenPair).toEqual(TOKEN_PAIR);
    expect(mockUserService.findById).toHaveBeenCalledWith('user-1');
    expect(mockAuthService.generateTokensForUser).toHaveBeenCalledWith({
      id: 'user-1',
      username: 'operator',
      role: 'user',
    });
  });

  it('Ticket single consumption: redeeming the same ticket a second time throws 401 (anti-replay)', async () => {
    const previewTicket = service.issuePreviewTicket('user-1');
    await service.consumePreviewTicket(previewTicket);

    await expect(service.consumePreviewTicket(previewTicket)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Tickets older than 60 seconds cannot be redeemed', async () => {
    const previewTicket = service.issuePreviewTicket('user-1');
    jest.advanceTimersByTime(61 * 1000);

    await expect(service.consumePreviewTicket(previewTicket)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockAuthService.generateTokensForUser).not.toHaveBeenCalled();
  });

  it('Redeeming an unknown ticket throws 401', async () => {
    await expect(service.consumePreviewTicket('nonexistent-ticket')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Ticket bound user does not exist throws 401', async () => {
    mockUserService.findById.mockResolvedValue(null);
    const previewTicket = service.issuePreviewTicket('user-deleted');

    await expect(service.consumePreviewTicket(previewTicket)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockAuthService.generateTokensForUser).not.toHaveBeenCalled();
  });

  describe('buildPreviewUrl (Plan C: backend delivers the full shell URL)', () => {
    const originalShellBaseUrl = process.env.SCADA_SHELL_BASE_URL;

    afterEach(() => {
      if (originalShellBaseUrl === undefined) {
        delete process.env.SCADA_SHELL_BASE_URL;
      } else {
        process.env.SCADA_SHELL_BASE_URL = originalShellBaseUrl;
      }
    });

    it('Returns undefined when SCADA_SHELL_BASE_URL is not configured (frontend falls back to local assembly)', () => {
      delete process.env.SCADA_SHELL_BASE_URL;

      expect(
        service.buildPreviewUrl('ticket-abc', { projectId: 'demo', pageName: 'page-1' }),
      ).toBeUndefined();
    });

    it('Assemble the full preview URL from the configured base address (including all optional parameters)', () => {
      process.env.SCADA_SHELL_BASE_URL = 'http://localhost:5173';

      expect(
        service.buildPreviewUrl('ticket-abc', {
          projectId: 'demo',
          pageName: 'page-1',
          group: 'group-a',
        }),
      ).toBe(
        'http://localhost:5173/preview?ticket=ticket-abc&projectId=demo&pageName=page-1&group=group-a',
      );
    });

    it('When optional parameters are missing, the corresponding query items are not appended and the trailing slash of the base address is removed', () => {
      process.env.SCADA_SHELL_BASE_URL = '/scada-preview/';

      expect(service.buildPreviewUrl('ticket-abc', {})).toBe('/scada-preview/preview?ticket=ticket-abc');
    });
  });
});

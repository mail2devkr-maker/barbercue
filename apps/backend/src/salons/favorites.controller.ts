import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  FAVORITES_PATHS,
  Role,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FavoritesService } from './favorites.service';

// Customers only (the global auth guard rejects anonymous calls; RolesGuard rejects other roles).
@Controller(FAVORITES_PATHS.favorites)
@Roles(Role.CUSTOMER)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.list(user.id);
  }

  // Registered before :salonId so "ids" is never parsed as a salon id.
  @Get(FAVORITES_PATHS.ids)
  @Header('Cache-Control', 'private, no-store')
  ids(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.ids(user.id);
  }

  @Post(':salonId')
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.favorites.add(user.id, salonId);
  }

  @Delete(':salonId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId', ParseUUIDPipe) salonId: string,
  ) {
    return this.favorites.remove(user.id, salonId);
  }
}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { MainService } from './main/main.service';

async function bootstrap() {
    const server_app = await NestFactory.create(AppModule);
    const configService = server_app.get<ConfigService>(ConfigService);
    await server_app.listen(configService.get<string>('PORT') ?? 777);
    //only after listen, so the login route is reachable in case the browser has to be opened
    void server_app.get<MainService>(MainService).startup();
}
void bootstrap();

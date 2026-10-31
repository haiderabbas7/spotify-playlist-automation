import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { MainService } from './main/main.service';

async function bootstrap() {
    //no startup messages from Nest in the log, warnings and errors stay
    const server_app = await NestFactory.create(AppModule, { logger: ['warn', 'error', 'fatal'] });
    const configService = server_app.get<ConfigService>(ConfigService);
    await server_app.listen(configService.get<string>('PORT') ?? 777);
    //only after listen, so the login route is reachable in case the browser has to be opened
    void server_app.get<MainService>(MainService).startup();
}
void bootstrap();

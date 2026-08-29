# TZ-05 — Staging seed bundle

Этот комплект добавляет воспроизводимый staging seed и автоматический smoke-check.

## Что создаёт seed

- 4 тестовых Auth-пользователя: owner / expert / applicant / outsider;
- 4 публичных профиля;
- 1 проект/listing;
- accepted + pending application;
- 2 задачи;
- документ, событие, сообщения и вклад;
- 2 отзыва;
- request-аукцион и offer-аукцион;
- ставки;
- approved access request к закрытой части offer-аукциона.

Файлы Storage намеренно не подделываются: bucket `project-files` проверяется отдельно.

## Защита от случайного запуска

Seed запускается только если одновременно выполняется всё:

1. `SEED_CONFIRM=yes-staging`;
2. ref из `SUPABASE_URL` совпадает с `SUPABASE_PROJECT_REF`;
3. этот ref явно перечислен в `SEED_ALLOWED_REFS`.

Поэтому будущий production ref просто не добавляем в `SEED_ALLOWED_REFS`.

## Установка в проект

Распаковать bundle в корень `experts-nearby` с заменой `package.json`.

После распаковки:

```powershell
npm run check
```

## Когда staging Supabase будет создан

1. Скопировать:

```powershell
Copy-Item .\scripts\staging.env.example .\.env.staging.local
```

2. Заполнить `.env.staging.local` значениями ТОЛЬКО staging-проекта.

Никогда не коммитить и не присылать в чат service role key, secret key или пароль БД.

3. После накатывания baseline на staging:

```powershell
npm run seed:staging
npm run verify:staging
```

или одной командой:

```powershell
npm run staging:check
```

Успешный verify проверяет наличие fixtures, приватный bucket `project-files` и базовые RLS-сценарии:
owner/accepted expert видят проектные данные, outsider их не видит, approved requester видит закрытую часть offer-аукциона.

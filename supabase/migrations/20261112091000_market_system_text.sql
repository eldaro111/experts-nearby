-- 46 user-visible SQL literals in 9 functions. The reported 47th line is a
-- non-user-visible comment in create_notification_secure, intentionally unchanged.
-- No stored history/notifications/user content is rewritten. ACLs/owners preserved.
begin;
set local lock_timeout='5s';
do $preflight$
declare expected record; actual record;
begin
  for expected in select * from (values
    ('accept_auction_bid_secure', '0d740a25ff8ff7ffac3188d6b8c52d72', 'b3a55467b60d9b77e69ec545bec4cb21'),
    ('decide_auction_access_secure', '947b610d48a31c0f0f9234f69d5c0e6c', '0b3e864e74c04d64de0fc4db70228152'),
    ('guard_auction_bid_update', '16f5deb0f290e90d8096235044fb4ac7', '9066661594f7d028fcc3b566a7d11004'),
    ('guard_auction_status_transition', 'b0e6fb8062aff1339d1ff5668405427c', '95064a42e6c33ce68acaed29187fdc78'),
    ('request_auction_access_secure', '946b166ba43a267253467d59be4b1331', '91c2602aa3faa09b1bfb48a961e61b40'),
    ('review_auction_bid_secure', '02a7eb8d546a7ee3a3360188809dda66', '33a488940cc8420398ff9b2aa2a5519d'),
    ('save_auction_bid_secure', '031ac3a4b40d9090f9ffe132a62dfdb0', 'a78e876544280f554feb6c1411652cfa'),
    ('transition_auction_status_secure', 'e24964a4c2f456d18fcedce2f8e0dc47', 'c7b6477f75844ae5be3f6e36dd862cf0'),
    ('withdraw_auction_bid_secure', '024fa679340ea38d937e6876f73fbb9c', '7e584ae59641c705210506128347caab')
  ) v(name,old_hash,new_hash) loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=expected.name) <> 1 then
      raise exception 'ER-001: unexpected overload/missing function %', expected.name;
    end if;
    select p.*, pg_get_userbyid(p.proowner) as owner into actual from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=expected.name;
    if actual.owner <> 'postgres' or md5(replace(actual.prosrc,chr(13),'')) not in (expected.old_hash,expected.new_hash) then
      raise exception 'ER-001: unexpected definition/owner of %. Stop and inspect schema drift.',expected.name;
    end if;
  end loop;
end $preflight$;

create or replace function public.accept_auction_bid_secure (
  p_expected_owner_id uuid,
  p_bid_id            uuid
)
  returns table (
    auction_id          uuid,
    accepted_bid_id     uuid,
    winner_id           uuid,
    project_id          uuid,
    project_was_created boolean,
    already_completed   boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
#variable_conflict use_column
declare
  v_owner_id uuid := auth.uid();
  v_bid public.auction_bids%rowtype;
  v_auction public.auctions%rowtype;
  v_project_id uuid;
  v_project_was_created boolean := false;
  v_description text;
  v_has_listing_user_id boolean;
  v_other_bid record;
begin
  if v_owner_id is null then
    raise exception 'Для принятия предложения требуется авторизация.';
  end if;

  if p_expected_owner_id is null
     or p_expected_owner_id is distinct from v_owner_id then
    raise exception 'owner_id не совпадает с текущим пользователем.';
  end if;

  select selected_bid.*
    into v_bid
  from public.auction_bids as selected_bid
  where selected_bid.id = p_bid_id
  for update;

  if not found then
    raise exception 'Предложение не найдено.';
  end if;

  select target_auction.*
    into v_auction
  from public.auctions as target_auction
  where target_auction.id = v_bid.auction_id
  for update;

  if not found then
    raise exception 'Объявление не найдено.';
  end if;

  if v_auction.owner_id is distinct from v_owner_id then
    raise exception 'Только автор объявления может выбрать предложение.';
  end if;

  if v_bid.bidder_id = v_owner_id then
    raise exception 'Нельзя принять собственное предложение.';
  end if;

  -- Повторный вызов после уже успешно завершённой транзакции безопасен.
  if v_bid.status = 'accepted' then
    if v_auction.status <> 'closed' then
      raise exception
        'Состояние объявления повреждено: выбранное предложение у незакрытого объявления.';
    end if;

    return query
    select
      v_auction.id,
      v_bid.id,
      v_bid.bidder_id,
      v_auction.linked_listing_id,
      false,
      true;

    return;
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Выбрать предложение можно только у открытого объявления.';
  end if;

  if v_auction.ends_at is not null
     and v_auction.ends_at <= now() then
    raise exception 'Срок приёма предложений уже закончился.';
  end if;

  if v_bid.status not in ('new', 'shortlisted') then
    raise exception
      'Принять можно только новое предложение или предложение из шортлиста.';
  end if;

  if exists (
    select 1
    from public.auction_bids as accepted_bid
    where accepted_bid.auction_id = v_auction.id
      and accepted_bid.status = 'accepted'
      and accepted_bid.id <> v_bid.id
  ) then
    raise exception 'У объявления уже есть выбранное предложение.';
  end if;

  v_project_id := v_auction.linked_listing_id;

  if v_auction.type = 'request' then
    if v_project_id is not null then
      if not exists (
        select 1
        from public.listings as linked_project
        where linked_project.id = v_project_id
          and linked_project.created_by = v_owner_id
      ) then
        raise exception
          'Связанный проект не найден или не принадлежит автору объявления.';
      end if;
    else
      v_description := concat_ws(
        '',
        coalesce(
          nullif(v_auction.public_description, ''),
          nullif(v_auction.public_summary, ''),
          v_auction.title
        ),
        case
          when nullif(v_auction.expected_result, '') is not null
            then E'\n\nОжидаемый результат:\n' || v_auction.expected_result
          else ''
        end,
        case
          when nullif(v_auction.selection_criteria, '') is not null
            then E'\n\nКритерии выбора/приёмки:\n' || v_auction.selection_criteria
          else ''
        end,
        case
          when nullif(v_bid.terms, '') is not null
            then E'\n\nПринятое предложение исполнителя:\n' || v_bid.terms
          else ''
        end,
        case
          when nullif(v_bid.message, '') is not null
            then E'\n\nСообщение исполнителя:\n' || v_bid.message
          else ''
        end
      );

      select exists (
        select 1
        from information_schema.columns as column_info
        where column_info.table_schema = 'public'
          and column_info.table_name = 'listings'
          and column_info.column_name = 'user_id'
      )
      into v_has_listing_user_id;

      if v_has_listing_user_id then
        execute $insert$
          insert into public.listings (
            title,
            description,
            roles_needed,
            skills,
            timezone,
            created_by,
            user_id
          )
          values ($1, $2, $3, $4, $5, $6, $6)
          returning id
        $insert$
        into v_project_id
        using
          v_auction.title,
          v_description,
          v_auction.required_roles,
          v_auction.required_skills,
          'UTC+3',
          v_owner_id;
      else
        insert into public.listings (
          title,
          description,
          roles_needed,
          skills,
          timezone,
          created_by
        )
        values (
          v_auction.title,
          v_description,
          v_auction.required_roles,
          v_auction.required_skills,
          'UTC+3',
          v_owner_id
        )
        returning listings.id into v_project_id;
      end if;

      v_project_was_created := true;
    end if;

    insert into public.applications (
      listing_id,
      user_id,
      status,
      invited_by_author
    )
    values (
      v_project_id,
      v_bid.bidder_id,
      'accepted',
      false
    )
    on conflict (listing_id, user_id)
    do update
      set status = excluded.status,
          invited_by_author = excluded.invited_by_author;
  end if;

  perform set_config('app.auction_accept_rpc', 'on', true);

  update public.auction_bids as selected_bid
  set status = 'accepted'
  where selected_bid.id = v_bid.id;

  for v_other_bid in
    update public.auction_bids as other_bid
    set status = 'rejected'
    where other_bid.auction_id = v_auction.id
      and other_bid.id <> v_bid.id
      and other_bid.status in ('new', 'shortlisted')
    returning other_bid.id, other_bid.bidder_id
  loop
    perform public.insert_auction_decision_notification_internal(
      v_other_bid.bidder_id,
      v_owner_id,
      v_project_id,
      'auction_bid_rejected',
      'Ваше предложение отклонено',
      format(
        'По объявлению «%s» выбрано другое предложение.',
        v_auction.title
      ),
      format('/auctions/%s', v_auction.id),
      jsonb_build_object(
        'auction_id', v_auction.id,
        'bid_id', v_other_bid.id,
        'listing_id', v_project_id
      )
    );
  end loop;

  update public.auctions as target_auction
  set
    status = 'closed',
    linked_listing_id = coalesce(
      v_project_id,
      target_auction.linked_listing_id
    )
  where target_auction.id = v_auction.id;

  if v_auction.type = 'request'
     and v_project_id is not null then
    insert into public.project_activity (
      project_id,
      actor_id,
      type,
      title,
      body,
      entity_type,
      entity_id,
      metadata
    )
    select
      v_project_id,
      v_owner_id,
      'project_member_added_via_auction',
      case
        when v_project_was_created
          then format(
            'Проект создан из объявления «%s»',
            v_auction.title
          )
        else 'Автор выбранного предложения добавлен в проект'
      end,
      case
        when v_project_was_created
          then 'Автор выбранного предложения добавлен в новую рабочую зону.'
        else format(
          'Автор выбранного предложения по объявлению «%s» добавлен в рабочую зону.',
          v_auction.title
        )
      end,
      'auction_bid',
      v_bid.id,
      jsonb_build_object(
        'auction_id', v_auction.id,
        'auction_title', v_auction.title,
        'bid_id', v_bid.id,
        'bidder_id', v_bid.bidder_id,
        'project_was_created', v_project_was_created
      )
    where not exists (
      select 1
      from public.project_activity as activity
      where activity.project_id = v_project_id
        and activity.type = 'project_member_added_via_auction'
        and activity.entity_type = 'auction_bid'
        and activity.entity_id = v_bid.id
    );
  end if;

  perform public.insert_auction_decision_notification_internal(
    v_bid.bidder_id,
    v_owner_id,
    v_project_id,
    'auction_bid_accepted',
    'Ваше предложение принято',
    case
      when v_auction.type = 'request'
           and v_project_id is not null
        then format(
          'Ваше предложение по объявлению «%s» выбрано. Вы добавлены в проект.',
          v_auction.title
        )
      else format(
        'Ваше предложение по объявлению «%s» выбрано.',
        v_auction.title
      )
    end,
    case
      when v_auction.type = 'request'
           and v_project_id is not null
        then format('/projects/%s', v_project_id)
      else format('/auctions/%s', v_auction.id)
    end,
    jsonb_build_object(
      'auction_id', v_auction.id,
      'bid_id', v_bid.id,
      'listing_id', v_project_id,
      'project_was_created', v_project_was_created
    )
  );

  return query
  select
    v_auction.id,
    v_bid.id,
    v_bid.bidder_id,
    v_project_id,
    v_project_was_created,
    false;
end
$function$;

create or replace function public.decide_auction_access_secure (
  p_expected_owner_id uuid,
  p_request_id        uuid,
  p_target_status     text
)
  returns table (
    request_id        uuid,
    status            text,
    already_completed boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_owner_id uuid := auth.uid();
  v_request public.auction_access_requests%rowtype;
  v_auction public.auctions%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Для решения по доступу требуется авторизация.';
  end if;

  if p_expected_owner_id is null
     or p_expected_owner_id is distinct from v_owner_id then
    raise exception 'owner_id не совпадает с текущим пользователем.';
  end if;

  if p_target_status not in ('approved', 'rejected') then
    raise exception 'Недопустимый статус решения.';
  end if;

  select r.*
    into v_request
  from public.auction_access_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'Запрос доступа не найден.';
  end if;

  select a.*
    into v_auction
  from public.auctions a
  where a.id = v_request.auction_id
  for update;

  if v_auction.owner_id is distinct from v_owner_id then
    raise exception 'Только автор объявления может рассматривать запрос.';
  end if;

  if v_auction.type <> 'offer' then
    raise exception 'Запрос относится не к объявлению о готовом проекте.';
  end if;

  if v_request.status = p_target_status then
    return query
    select v_request.id, v_request.status, true;
    return;
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Решение по этому запросу уже принято.';
  end if;

  update public.auction_access_requests
  set
    status = p_target_status,
    reviewed_by = v_owner_id,
    reviewed_at = now()
  where id = v_request.id;

  perform public.insert_auction_decision_notification_internal(
    v_request.requester_id,
    v_owner_id,
    v_auction.linked_listing_id,
    case
      when p_target_status = 'approved'
        then 'auction_access_approved'
      else 'auction_access_rejected'
    end,
    case
      when p_target_status = 'approved'
        then 'Доступ к материалам одобрен'
      else 'Доступ к материалам отклонён'
    end,
    case
      when p_target_status = 'approved'
        then format(
          'Вам открыли закрытые материалы объявления «%s».',
          v_auction.title
        )
      else format(
        'Ваш запрос доступа к материалам объявления «%s» отклонён.',
        v_auction.title
      )
    end,
    format('/auctions/%s', v_auction.id),
    jsonb_build_object(
      'auction_id', v_auction.id,
      'access_request_id', v_request.id
    )
  );

  return query select v_request.id, p_target_status, false;
end
$function$;

create or replace function public.guard_auction_bid_update()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if new.auction_id is distinct from old.auction_id
     or new.bidder_id is distinct from old.bidder_id then
    raise exception
      'Нельзя изменять auction_id или bidder_id существующего предложения.';
  end if;

  if current_user not in (
    'postgres',
    'service_role',
    'supabase_admin'
  ) then
    raise exception
      'Изменение предложения выполняется только через защищённый RPC.';
  end if;

  return new;
end
$function$;

create or replace function public.guard_auction_status_transition()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('closed', 'cancelled') then
    raise exception 'Финальный статус объявления нельзя изменить.';
  end if;

  if old.status = 'draft' and new.status = 'open' then
    return new;
  end if;

  if new.status in ('closed', 'cancelled')
     and current_user in (
       'postgres',
       'service_role',
       'supabase_admin'
     ) then
    return new;
  end if;

  raise exception
    'Этот переход статуса выполняется только через защищённый RPC.';
end
$function$;

create or replace function public.request_auction_access_secure (
  p_expected_requester_id uuid,
  p_auction_id            uuid,
  p_message               text default null::text
)
  returns table (
    request_id     uuid,
    created        boolean,
    current_status text
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_requester_id uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_request public.auction_access_requests%rowtype;
  v_request_id uuid;
begin
  if v_requester_id is null then
    raise exception 'Для запроса доступа требуется авторизация.';
  end if;

  if p_expected_requester_id is null
     or p_expected_requester_id is distinct from v_requester_id then
    raise exception 'requester_id не совпадает с текущим пользователем.';
  end if;

  if p_message is not null and char_length(p_message) > 4000 then
    raise exception 'Комментарий слишком длинный.';
  end if;

  select a.*
    into v_auction
  from public.auctions a
  where a.id = p_auction_id
  for update;

  if not found then
    raise exception 'Объявление не найдено.';
  end if;

  if v_auction.type <> 'offer' then
    raise exception 'Закрытые материалы доступны только у объявления о готовом проекте.';
  end if;

  if v_auction.owner_id = v_requester_id then
    raise exception 'Владелец уже имеет доступ к материалам.';
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Запросить доступ можно только у открытого объявления.';
  end if;

  select r.*
    into v_request
  from public.auction_access_requests r
  where r.auction_id = p_auction_id
    and r.requester_id = v_requester_id
  for update;

  if found then
    return query
    select v_request.id, false, v_request.status;
    return;
  end if;

  insert into public.auction_access_requests (
    auction_id,
    requester_id,
    message,
    status
  )
  values (
    p_auction_id,
    v_requester_id,
    nullif(btrim(coalesce(p_message, '')), ''),
    'pending'
  )
  returning id into v_request_id;

  perform public.insert_auction_decision_notification_internal(
    v_auction.owner_id,
    v_requester_id,
    v_auction.linked_listing_id,
    'auction_access_requested',
    'Запрос доступа к закрытым материалам',
    format(
      'Пользователь запросил доступ к закрытой части объявления «%s».',
      v_auction.title
    ),
    format('/auctions/%s', v_auction.id),
    jsonb_build_object(
      'auction_id', v_auction.id,
      'access_request_id', v_request_id
    )
  );

  return query select v_request_id, true, 'pending'::text;
end
$function$;

create or replace function public.review_auction_bid_secure (
  p_expected_owner_id uuid,
  p_bid_id            uuid,
  p_target_status     text
)
  returns table (
    bid_id            uuid,
    status            text,
    already_completed boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_owner_id uuid := auth.uid();
  v_bid public.auction_bids%rowtype;
  v_auction public.auctions%rowtype;
begin
  if v_owner_id is null then
    raise exception 'Для решения по предложению требуется авторизация.';
  end if;

  if p_expected_owner_id is null
     or p_expected_owner_id is distinct from v_owner_id then
    raise exception 'owner_id не совпадает с текущим пользователем.';
  end if;

  if p_target_status not in ('shortlisted', 'rejected') then
    raise exception 'Недопустимый статус решения.';
  end if;

  select b.*
    into v_bid
  from public.auction_bids b
  where b.id = p_bid_id
  for update;

  if not found then
    raise exception 'Предложение не найдено.';
  end if;

  select a.*
    into v_auction
  from public.auctions a
  where a.id = v_bid.auction_id
  for update;

  if v_auction.owner_id is distinct from v_owner_id then
    raise exception 'Только автор объявления может менять статус предложения.';
  end if;

  if v_bid.status = p_target_status then
    return query select v_bid.id, v_bid.status, true;
    return;
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Решения можно принимать только в открытом объявлении.';
  end if;

  if v_bid.status not in ('new', 'shortlisted') then
    raise exception 'Статус этого предложения уже финальный.';
  end if;

  update public.auction_bids
  set status = p_target_status
  where id = v_bid.id;

  if p_target_status = 'rejected' then
    perform public.insert_auction_decision_notification_internal(
      v_bid.bidder_id,
      v_owner_id,
      v_auction.linked_listing_id,
      'auction_bid_rejected',
      'Ваше предложение отклонено',
      format(
        'Ваше предложение по объявлению «%s» отклонено.',
        v_auction.title
      ),
      format('/auctions/%s', v_auction.id),
      jsonb_build_object(
        'auction_id', v_auction.id,
        'bid_id', v_bid.id
      )
    );
  end if;

  return query select v_bid.id, p_target_status, false;
end
$function$;

create or replace function public.save_auction_bid_secure (
  p_expected_bidder_id uuid,
  p_auction_id         uuid,
  p_amount             numeric                  default null::numeric,
  p_currency           text                     default 'RUB'::text,
  p_proposed_deadline  timestamp with time zone default null::timestamp with time zone,
  p_terms              text                     default null::text,
  p_message            text                     default null::text,
  p_deal_type          text                     default null::text
)
  returns table (
    bid_id  uuid,
    created boolean,
    resumed boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_bidder_id uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_bid public.auction_bids%rowtype;
  v_bid_id uuid;
  v_created boolean := false;
  v_resumed boolean := false;
  v_currency text;
begin
  if v_bidder_id is null then
    raise exception 'Для подачи предложения требуется авторизация.';
  end if;

  if p_expected_bidder_id is null
     or p_expected_bidder_id is distinct from v_bidder_id then
    raise exception 'bidder_id не совпадает с текущим пользователем.';
  end if;

  select a.*
    into v_auction
  from public.auctions a
  where a.id = p_auction_id
  for update;

  if not found then
    raise exception 'Объявление не найдено.';
  end if;

  if v_auction.owner_id = v_bidder_id then
    raise exception 'Нельзя подать предложение на собственное объявление.';
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Объявление не принимает предложения.';
  end if;

  if v_auction.ends_at is not null
     and v_auction.ends_at <= now() then
    raise exception 'Срок приёма предложений закончился.';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'Сумма предложения не может быть отрицательной.';
  end if;

  v_currency := upper(btrim(coalesce(p_currency, 'RUB')));

  if v_currency = ''
     or char_length(v_currency) > 12 then
    raise exception 'Некорректная валюта.';
  end if;

  if p_terms is not null and char_length(p_terms) > 10000 then
    raise exception 'Условия предложения слишком длинные.';
  end if;

  if p_message is not null and char_length(p_message) > 4000 then
    raise exception 'Сообщение слишком длинное.';
  end if;

  if p_deal_type is not null and char_length(p_deal_type) > 120 then
    raise exception 'Тип сделки слишком длинный.';
  end if;

  select b.*
    into v_bid
  from public.auction_bids b
  where b.auction_id = p_auction_id
    and b.bidder_id = v_bidder_id
  for update;

  if not found then
    insert into public.auction_bids (
      auction_id,
      bidder_id,
      amount,
      currency,
      proposed_deadline,
      terms,
      message,
      deal_type,
      status
    )
    values (
      p_auction_id,
      v_bidder_id,
      p_amount,
      v_currency,
      p_proposed_deadline,
      nullif(btrim(coalesce(p_terms, '')), ''),
      nullif(btrim(coalesce(p_message, '')), ''),
      nullif(btrim(coalesce(p_deal_type, '')), ''),
      'new'
    )
    returning id into v_bid_id;

    v_created := true;
  else
    if v_bid.status in ('accepted', 'rejected') then
      raise exception 'Финальное предложение нельзя изменить.';
    end if;

    if v_bid.status = 'shortlisted' then
      raise exception
        'Предложение из шортлиста нельзя редактировать. Его можно только отозвать.';
    end if;

    v_resumed := v_bid.status = 'withdrawn';

    update public.auction_bids
    set
      amount = p_amount,
      currency = v_currency,
      proposed_deadline = p_proposed_deadline,
      terms = nullif(btrim(coalesce(p_terms, '')), ''),
      message = nullif(btrim(coalesce(p_message, '')), ''),
      deal_type = nullif(btrim(coalesce(p_deal_type, '')), ''),
      status = 'new'
    where id = v_bid.id
    returning id into v_bid_id;
  end if;

  if v_created or v_resumed then
    perform public.insert_auction_decision_notification_internal(
      v_auction.owner_id,
      v_bidder_id,
      v_auction.linked_listing_id,
      'auction_new_bid',
      case
        when v_resumed then 'Повторное предложение по объявлению'
        else 'Новое предложение по объявлению'
      end,
      case
        when v_resumed
          then format(
            'По объявлению «%s» повторно подали предложение.',
            v_auction.title
          )
        else format(
          'По объявлению «%s» подали новое предложение.',
          v_auction.title
        )
      end,
      format('/auctions/%s', v_auction.id),
      jsonb_build_object(
        'auction_id', v_auction.id,
        'auction_title', v_auction.title,
        'bid_id', v_bid_id
      )
    );
  end if;

  return query
  select v_bid_id, v_created, v_resumed;
end
$function$;

create or replace function public.transition_auction_status_secure (
  p_expected_owner_id uuid,
  p_auction_id        uuid,
  p_target_status     text
)
  returns table (
    auction_id        uuid,
    status            text,
    already_completed boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
#variable_conflict use_column
declare
  v_owner_id uuid := auth.uid();
  v_auction public.auctions%rowtype;
  v_bid record;
begin
  if v_owner_id is null then
    raise exception 'Для изменения статуса требуется авторизация.';
  end if;

  if p_expected_owner_id is null
     or p_expected_owner_id is distinct from v_owner_id then
    raise exception 'owner_id не совпадает с текущим пользователем.';
  end if;

  if p_target_status not in ('closed', 'cancelled') then
    raise exception 'Недопустимый целевой статус объявления.';
  end if;

  select a.*
    into v_auction
  from public.auctions as a
  where a.id = p_auction_id
  for update;

  if not found then
    raise exception 'Объявление не найдено.';
  end if;

  if v_auction.owner_id is distinct from v_owner_id then
    raise exception 'Только автор может менять статус объявления.';
  end if;

  if v_auction.status = p_target_status then
    return query
    select v_auction.id, v_auction.status, true;
    return;
  end if;

  if v_auction.status in ('closed', 'cancelled') then
    raise exception 'Финальный статус объявления нельзя изменить.';
  end if;

  if p_target_status = 'closed'
     and v_auction.status <> 'open' then
    raise exception 'Закрыть можно только открытое объявление.';
  end if;

  if p_target_status = 'cancelled'
     and v_auction.status not in ('draft', 'open') then
    raise exception 'Отменить можно только черновик или открытое объявление.';
  end if;

  if exists (
    select 1
    from public.auction_bids as b
    where b.auction_id = v_auction.id
      and b.status = 'accepted'
  ) then
    raise exception
      'Объявление с выбранным предложением закрывается только процедурой выбора предложения.';
  end if;

  for v_bid in
    update public.auction_bids as b
    set status = 'rejected'
    where b.auction_id = v_auction.id
      and b.status in ('new', 'shortlisted')
    returning b.id, b.bidder_id
  loop
    perform public.insert_auction_decision_notification_internal(
      v_bid.bidder_id,
      v_owner_id,
      v_auction.linked_listing_id,
      'auction_bid_rejected',
      case
        when p_target_status = 'cancelled'
          then 'Объявление отменено'
        else 'Объявление закрыто'
      end,
      case
        when p_target_status = 'cancelled'
          then format(
            'Объявление «%s» отменено автором.',
            v_auction.title
          )
        else format(
          'Объявление «%s» закрыто без выбора предложения.',
          v_auction.title
        )
      end,
      format('/auctions/%s', v_auction.id),
      jsonb_build_object(
        'auction_id', v_auction.id,
        'bid_id', v_bid.id,
        'closed_without_winner', p_target_status = 'closed',
        'auction_cancelled', p_target_status = 'cancelled'
      )
    );
  end loop;

  update public.auctions as a
  set status = p_target_status
  where a.id = v_auction.id;

  return query
  select v_auction.id, p_target_status, false;
end
$function$;

create or replace function public.withdraw_auction_bid_secure (
  p_expected_bidder_id uuid,
  p_bid_id             uuid
)
  returns table (
    bid_id            uuid,
    already_withdrawn boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_bidder_id uuid := auth.uid();
  v_bid public.auction_bids%rowtype;
  v_auction public.auctions%rowtype;
begin
  if v_bidder_id is null then
    raise exception 'Для отзыва предложения требуется авторизация.';
  end if;

  if p_expected_bidder_id is null
     or p_expected_bidder_id is distinct from v_bidder_id then
    raise exception 'bidder_id не совпадает с текущим пользователем.';
  end if;

  select b.*
    into v_bid
  from public.auction_bids b
  where b.id = p_bid_id
  for update;

  if not found then
    raise exception 'Предложение не найдено.';
  end if;

  if v_bid.bidder_id is distinct from v_bidder_id then
    raise exception 'Можно отзывать только собственное предложение.';
  end if;

  select a.*
    into v_auction
  from public.auctions a
  where a.id = v_bid.auction_id
  for update;

  if v_bid.status = 'withdrawn' then
    return query select v_bid.id, true;
    return;
  end if;

  if v_bid.status not in ('new', 'shortlisted') then
    raise exception 'Это предложение уже нельзя отозвать.';
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Объявление уже не открыто.';
  end if;

  update public.auction_bids
  set status = 'withdrawn'
  where id = v_bid.id;

  return query select v_bid.id, false;
end
$function$;

notify pgrst, 'reload schema';
commit;

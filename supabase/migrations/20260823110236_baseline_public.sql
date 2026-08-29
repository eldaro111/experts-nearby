set local check_function_bodies = off;

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "anon";

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "authenticated";

alter default privileges for role "postgres" in schema "public" revoke all on sequences from "service_role";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "anon";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "authenticated";

alter default privileges for role "postgres" in schema "public" revoke all on tables from "service_role";

create table "public"."applications" (
  "id"                uuid                        not null default gen_random_uuid(),
  "listing_id"        uuid                        not null default gen_random_uuid(),
  "user_id"           uuid                        default gen_random_uuid(),
  "created_at"        timestamp without time zone,
  "status"            text                        default 'pending'::text,
  "invited_by_author" boolean                     not null default false,
  constraint "applications_pkey" primary key (id)
);

alter table "public"."applications"
  enable row level security;

create table "public"."auction_access_requests" (
  "id"           uuid                     not null default gen_random_uuid(),
  "auction_id"   uuid                     not null,
  "requester_id" uuid                     not null,
  "message"      text,
  "status"       text                     not null default 'pending'::text,
  "reviewed_by"  uuid,
  "reviewed_at"  timestamp with time zone,
  "created_at"   timestamp with time zone not null default now(),
  "updated_at"   timestamp with time zone not null default now(),
  constraint "auction_access_requests_auction_id_requester_id_key" unique (auction_id, requester_id),
  constraint "auction_access_requests_pkey" primary key (id),
  constraint "auction_access_requests_status_check" check ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);

alter table "public"."auction_access_requests"
  enable row level security;

create table "public"."auction_bids" (
  "id"                uuid                     not null default gen_random_uuid(),
  "auction_id"        uuid                     not null,
  "bidder_id"         uuid                     not null,
  "amount"            numeric,
  "currency"          text                     not null default 'RUB'::text,
  "proposed_deadline" timestamp with time zone,
  "terms"             text,
  "message"           text,
  "deal_type"         text,
  "status"            text                     not null default 'new'::text,
  "created_at"        timestamp with time zone not null default now(),
  "updated_at"        timestamp with time zone not null default now(),
  constraint "auction_bids_auction_id_bidder_id_key" unique (auction_id, bidder_id),
  constraint "auction_bids_pkey" primary key (id),
  constraint "auction_bids_status_check" check ((status = ANY (ARRAY['new'::text, 'shortlisted'::text, 'accepted'::text, 'rejected'::text, 'withdrawn'::text])))
);

alter table "public"."auction_bids"
  enable row level security;

create table "public"."auction_protected" (
  "auction_id"            uuid                     not null,
  "protected_description" text,
  "protected_links"       jsonb                    not null default '[]'::jsonb,
  "updated_at"            timestamp with time zone not null default now(),
  constraint "auction_protected_pkey" primary key (auction_id)
);

alter table "public"."auction_protected"
  enable row level security;

create table "public"."auctions" (
  "id"                   uuid                     not null default gen_random_uuid(),
  "owner_id"             uuid                     not null,
  "type"                 text                     not null,
  "title"                text                     not null,
  "public_summary"       text,
  "public_description"   text,
  "category"             text,
  "budget_min"           numeric,
  "budget_max"           numeric,
  "currency"             text                     not null default 'RUB'::text,
  "required_roles"       text[]                   not null default '{}'::text[],
  "required_skills"      text[]                   not null default '{}'::text[],
  "expected_result"      text,
  "selection_criteria"   text,
  "deal_type"            text,
  "readiness_level"      text,
  "implementation_needs" text,
  "nda_required"         boolean                  not null default false,
  "ip_mode"              text,
  "linked_listing_id"    uuid,
  "status"               text                     not null default 'open'::text,
  "ends_at"              timestamp with time zone,
  "created_at"           timestamp with time zone not null default now(),
  "updated_at"           timestamp with time zone not null default now(),
  constraint "auctions_pkey" primary key (id),
  constraint "auctions_status_check" check ((status = ANY (ARRAY['draft'::text, 'open'::text, 'closed'::text, 'cancelled'::text]))),
  constraint "auctions_type_check" check ((type = ANY (ARRAY['request'::text, 'offer'::text])))
);

alter table "public"."auctions"
  enable row level security;

create table "public"."contributions" (
  "id"          uuid                     not null default gen_random_uuid(),
  "project_id"  uuid                     not null,
  "user_id"     uuid                     not null,
  "task_id"     uuid,
  "kind"        text                     not null default 'other'::text,
  "title"       text                     not null,
  "description" text,
  "link"        text,
  "hours"       numeric,
  "verified_by" uuid,
  "verified_at" timestamp with time zone,
  "created_at"  timestamp with time zone default now(),
  constraint "contributions_pkey" primary key (id)
);

alter table "public"."contributions"
  enable row level security;

create table "public"."listings" (
  "id"           uuid                     not null default gen_random_uuid(),
  "user_id"      uuid                     not null,
  "title"        text,
  "description"  text,
  "roles_needed" text[],
  "skills"       text[],
  "timezone"     text,
  "visibility"   text                     default 'public'::text,
  "created_at"   timestamp with time zone default now(),
  "created_by"   uuid,
  "deadline_at"  timestamp with time zone,
  constraint "listings_pkey" primary key (id)
);

alter table "public"."listings"
  enable row level security;

create table "public"."notifications" (
  "id"           uuid                     not null default gen_random_uuid(),
  "recipient_id" uuid                     not null,
  "actor_id"     uuid,
  "project_id"   uuid,
  "type"         text                     not null,
  "title"        text                     not null,
  "body"         text,
  "href"         text,
  "payload"      jsonb                    not null default '{}'::jsonb,
  "read_at"      timestamp with time zone,
  "created_at"   timestamp with time zone not null default now(),
  constraint "notifications_pkey" primary key (id)
);

alter table "public"."notifications"
  enable row level security;

create table "public"."profile_reviews" (
  "id"               uuid                     not null default gen_random_uuid(),
  "project_id"       uuid                     not null,
  "reviewer_id"      uuid                     not null,
  "reviewed_user_id" uuid                     not null,
  "rating"           integer                  not null,
  "text"             text,
  "created_at"       timestamp with time zone not null default now(),
  "updated_at"       timestamp with time zone not null default now(),
  constraint "profile_reviews_check" check ((reviewer_id <> reviewed_user_id)),
  constraint "profile_reviews_pkey" primary key (id),
  constraint "profile_reviews_project_id_reviewer_id_reviewed_user_id_key" unique (project_id, reviewer_id, reviewed_user_id),
  constraint "profile_reviews_rating_check" check (((rating >= 1) AND (rating <= 5)))
);

alter table "public"."profile_reviews"
  enable row level security;

create table "public"."profiles" (
  "display_name"       text                     not null default ''::text,
  "roles"              text[],
  "skills"             text[],
  "timezone"           text,
  "availability_hours" integer,
  "links"              jsonb                    default '{"orcid": "", "github": ""}'::jsonb,
  "created_at"         timestamp with time zone default now(),
  "city"               text,
  "work_format"        text,
  "experience_level"   text,
  "hourly_rate"        numeric,
  "portfolio_links"    jsonb                    not null default '[]'::jsonb,
  "about"              text,
  "visibility"         text                     not null default 'public'::text,
  "show_rate"          boolean                  not null default true,
  "show_city"          boolean                  not null default true,
  "show_portfolio"     boolean                  not null default true,
  "show_availability"  boolean                  not null default true,
  constraint "profiles_experience_level_check"
    check (((experience_level IS NULL) OR (experience_level = ANY (ARRAY['junior'::text, 'middle'::text, 'senior'::text, 'expert'::text])))),
  constraint "profiles_visibility_check" check ((visibility = ANY (ARRAY['public'::text, 'platform_only'::text, 'hidden'::text]))),
  constraint "profiles_work_format_check" check (((work_format IS NULL) OR (work_format = ANY (ARRAY['remote'::text, 'onsite'::text, 'hybrid'::text])))),
  "user_id"            uuid                     not null default auth.uid(),
  constraint "Acc Experts_pkey" primary key (user_id)
);

alter table "public"."profiles"
  enable row level security;

create table "public"."project_activity" (
  "id"          uuid                     not null default gen_random_uuid(),
  "project_id"  uuid                     not null,
  "actor_id"    uuid,
  "type"        text                     not null,
  "title"       text                     not null,
  "body"        text,
  "entity_type" text,
  "entity_id"   uuid,
  "metadata"    jsonb                    not null default '{}'::jsonb,
  "created_at"  timestamp with time zone not null default now(),
  constraint "project_activity_pkey" primary key (id)
);

alter table "public"."project_activity"
  enable row level security;

create table "public"."project_documents" (
  "id"         uuid                     not null default gen_random_uuid(),
  "project_id" uuid                     not null,
  "author_id"  uuid                     not null,
  "title"      text                     not null,
  "content"    text                     not null default ''::text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  constraint "project_documents_pkey" primary key (id)
);

alter table "public"."project_documents"
  enable row level security;

create table "public"."project_events" (
  "id"          uuid                     not null default gen_random_uuid(),
  "project_id"  uuid                     not null,
  "created_by"  uuid                     not null,
  "title"       text                     not null,
  "description" text,
  "event_type"  text                     not null default 'other'::text,
  "starts_at"   timestamp with time zone not null,
  "ends_at"     timestamp with time zone,
  "created_at"  timestamp with time zone default now(),
  constraint "project_events_pkey" primary key (id)
);

alter table "public"."project_events"
  enable row level security;

create table "public"."project_file_upload_reservations" (
  "id"            uuid                     not null default gen_random_uuid(),
  "project_id"    uuid                     not null,
  "user_id"       uuid                     not null,
  "file_path"     text                     not null,
  "file_name"     text                     not null,
  "file_size"     bigint                   not null,
  "mime_type"     text,
  "category"      text                     not null default 'other'::text,
  "description"   text,
  "version_label" text,
  "task_id"       uuid,
  "created_at"    timestamp with time zone not null default now(),
  "expires_at"    timestamp with time zone not null default (now() + '00:30:00'::interval),
  constraint "project_file_upload_reservations_file_path_key" unique (file_path),
  constraint "project_file_upload_reservations_pkey" primary key (id)
);

alter table "public"."project_file_upload_reservations"
  enable row level security;

create table "public"."project_files" (
  "id"                    uuid                     not null default gen_random_uuid(),
  "project_id"            uuid                     not null,
  "uploaded_by"           uuid                     not null,
  "file_name"             text                     not null,
  "file_path"             text                     not null,
  "file_size"             bigint,
  "mime_type"             text,
  "created_at"            timestamp with time zone default now(),
  "category"              text                     not null default 'other'::text,
  "description"           text,
  "version_label"         text,
  "task_id"               uuid,
  "upload_reservation_id" uuid,
  constraint "project_files_pkey" primary key (id)
);

alter table "public"."project_files"
  enable row level security;

create table "public"."project_message_hidden" (
  "id"         uuid                     not null default gen_random_uuid(),
  "message_id" uuid                     not null,
  "user_id"    uuid                     not null,
  "created_at" timestamp with time zone default now(),
  constraint "project_message_hidden_message_id_user_id_key" unique (message_id, user_id),
  constraint "project_message_hidden_pkey" primary key (id)
);

alter table "public"."project_message_hidden"
  enable row level security;

create table "public"."project_messages" (
  "id"                 uuid                     not null default gen_random_uuid(),
  "project_id"         uuid                     not null,
  "author_id"          uuid                     not null,
  "body"               text                     not null,
  "created_at"         timestamp with time zone default now(),
  "parent_message_id"  uuid,
  "edited_at"          timestamp with time zone,
  "is_deleted_for_all" boolean                  not null default false,
  constraint "project_messages_pkey" primary key (id)
);

alter table "public"."project_messages"
  enable row level security;

create table "public"."tasks" (
  "id"                uuid                     not null default gen_random_uuid(),
  "project_id"        uuid                     not null,
  "title"             text                     not null,
  "description"       text,
  "status"            text                     not null default 'todo'::text,
  "assignee_id"       uuid,
  "created_at"        timestamp with time zone default now(),
  "start_at"          timestamp with time zone,
  "due_at"            timestamp with time zone,
  "completed_at"      timestamp with time zone,
  "penalty_percent"   numeric                  not null default 10,
  "excuse_reason"     text,
  "excuse_status"     text                     not null default 'none'::text,
  "excuse_decided_by" uuid,
  "excuse_decided_at" timestamp with time zone,
  constraint "tasks_pkey" primary key (id)
);

alter table "public"."tasks"
  enable row level security;

create table "public"."user_settings" (
  "user_id"            uuid                     not null,
  "notification_prefs" jsonb                    not null default '{"files": true, "tasks": true, "reviews": true, "auctions": true, "projects": true, "invitations": true}'::jsonb,
  "email_prefs"        jsonb                    not null default '{}'::jsonb,
  "created_at"         timestamp with time zone not null default now(),
  "updated_at"         timestamp with time zone not null default now(),
  constraint "user_settings_pkey" primary key (user_id)
);

alter table "public"."user_settings"
  enable row level security;

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
    raise exception 'Аукцион не найден.';
  end if;

  if v_auction.owner_id is distinct from v_owner_id then
    raise exception 'Только владелец аукциона может принять предложение.';
  end if;

  if v_bid.bidder_id = v_owner_id then
    raise exception 'Нельзя принять собственное предложение.';
  end if;

  -- Повторный вызов после уже успешно завершённой транзакции безопасен.
  if v_bid.status = 'accepted' then
    if v_auction.status <> 'closed' then
      raise exception
        'Состояние аукциона повреждено: accepted-ставка у незакрытого аукциона.';
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
    raise exception 'Принять предложение можно только у открытого аукциона.';
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
    raise exception 'У аукциона уже есть принятое предложение.';
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
          'Связанный проект не найден или не принадлежит владельцу аукциона.';
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
        'По аукциону «%s» выбрано другое предложение.',
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
            'Проект создан из аукциона «%s»',
            v_auction.title
          )
        else 'Победитель аукциона добавлен в проект'
      end,
      case
        when v_project_was_created
          then 'Победитель принятого предложения добавлен в новую рабочую зону.'
        else format(
          'Победитель принятого предложения по аукциону «%s» добавлен в рабочую зону.',
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
          'Ваше предложение по аукциону «%s» принято. Вы добавлены в проект.',
          v_auction.title
        )
      else format(
        'Ваше предложение по аукциону «%s» принято.',
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

create or replace function public.append_project_activity_internal (
  p_project_id  uuid,
  p_type        text,
  p_title       text,
  p_body        text  default null::text,
  p_entity_type text  default null::text,
  p_entity_id   uuid  default null::uuid,
  p_metadata    jsonb default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_activity_id uuid;
begin
  if p_project_id is null then
    raise exception 'project_id обязателен для истории проекта.';
  end if;

  if p_type not in (
    'task_created',
    'task_completed',
    'task_status_changed',
    'task_assignee_changed',
    'task_deleted',
    'contribution_added',
    'contribution_verified',
    'file_uploaded',
    'file_deleted',
    'profile_review_created',
    'profile_review_updated'
  ) then
    raise exception 'Недопустимый внутренний тип истории: %', p_type;
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Заголовок истории обязателен.';
  end if;

  -- Для действий пользователя подтверждаем связь с проектом.
  -- Системные миграции с auth.uid() = null допускаются с actor_id = null.
  if v_actor_id is not null
     and not public.is_project_member(p_project_id, v_actor_id) then
    raise exception 'Пользователь не является участником проекта.';
  end if;

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
  values (
    p_project_id,
    v_actor_id,
    p_type,
    left(btrim(p_title), 300),
    case
      when p_body is null then null
      else left(p_body, 4000)
    end,
    nullif(btrim(coalesce(p_entity_type, '')), ''),
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_activity_id;

  return v_activity_id;
end
$function$;

create or replace function public.can_delete_project_file_object (
  p_file_path text,
  p_owner_id  text
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
begin
  if v_user_id is null then
    return false;
  end if;

  v_project_id :=
    public.project_file_project_id_from_path(p_file_path);

  if v_project_id is null
     or not public.project_file_is_member(v_project_id, v_user_id) then
    return false;
  end if;

  return
    p_owner_id = v_user_id::text
    or public.project_file_is_owner(v_project_id, v_user_id);
end
$function$;

create or replace function public.can_read_listing (
  p_listing_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select exists (
    select 1
    from public.listings l
    where l.id = p_listing_id
      and (
        l.visibility = 'public'
        or l.created_by = auth.uid()
        or (
          auth.uid() is not null
          and exists (
            select 1
            from public.applications a
            where a.listing_id = l.id
              and a.user_id = auth.uid()
          )
        )
      )
  );
$function$;

create or replace function public.can_read_project_file_object (
  p_file_path text,
  p_owner_id  text
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
begin
  if v_user_id is null then
    return false;
  end if;

  v_project_id :=
    public.project_file_project_id_from_path(p_file_path);

  if v_project_id is null
     or not public.project_file_is_member(v_project_id, v_user_id) then
    return false;
  end if;

  return
    exists (
      select 1
      from public.project_files pf
      where pf.project_id = v_project_id
        and pf.file_path = p_file_path
    )
    or p_owner_id = v_user_id::text;
end
$function$;

create or replace function public.can_view_profile_identity (
  p_target_user_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    p_target_user_id is not null
    and exists (
      select 1
      from public.profiles p
      where p.user_id = p_target_user_id
        and (
          -- Публичные профили доступны всем.
          p.visibility = 'public'

          -- Профили platform_only доступны только авторизованным.
          or (
            p.visibility = 'platform_only'
            and auth.uid() is not null
          )

          -- Свой профиль.
          or p.user_id = auth.uid()

          -- Автор публичного проекта должен быть атрибутирован
          -- даже при скрытом каталожном профиле.
          or exists (
            select 1
            from public.listings public_listing
            where public_listing.created_by = p.user_id
              and public_listing.visibility = 'public'
          )

          -- Дальнейшие правила требуют авторизации.
          or (
            auth.uid() is not null
            and (
              -- Владелец проекта видит личности всех откликнувшихся,
              -- приглашённых, действующих и бывших участников своего проекта.
              exists (
                select 1
                from public.listings owned_listing
                join public.applications target_application
                  on target_application.listing_id = owned_listing.id
                where owned_listing.created_by = auth.uid()
                  and target_application.user_id = p.user_id
              )

              -- Откликнувшийся/приглашённый пользователь видит автора проекта.
              or exists (
                select 1
                from public.listings target_owned_listing
                join public.applications viewer_application
                  on viewer_application.listing_id = target_owned_listing.id
                where target_owned_listing.created_by = p.user_id
                  and viewer_application.user_id = auth.uid()
              )

              -- Участники одной рабочей зоны видят друг друга.
              or exists (
                select 1
                from public.listings shared_listing
                where (
                  shared_listing.created_by = auth.uid()
                  or exists (
                    select 1
                    from public.applications viewer_membership
                    where viewer_membership.listing_id = shared_listing.id
                      and viewer_membership.user_id = auth.uid()
                      and viewer_membership.status = 'accepted'
                  )
                )
                and (
                  shared_listing.created_by = p.user_id
                  or exists (
                    select 1
                    from public.applications target_membership
                    where target_membership.listing_id = shared_listing.id
                      and target_membership.user_id = p.user_id
                      and target_membership.status = 'accepted'
                  )
                )
              )

              -- Сохраняем атрибуцию файлов бывших участников.
              or exists (
                select 1
                from public.project_files pf
                join public.listings file_listing
                  on file_listing.id = pf.project_id
                where pf.uploaded_by = p.user_id
                  and (
                    file_listing.created_by = auth.uid()
                    or exists (
                      select 1
                      from public.applications file_viewer_membership
                      where file_viewer_membership.listing_id = file_listing.id
                        and file_viewer_membership.user_id = auth.uid()
                        and file_viewer_membership.status = 'accepted'
                    )
                  )
              )

              -- Сохраняем атрибуцию событий бывших участников.
              or exists (
                select 1
                from public.project_activity pa
                join public.listings activity_listing
                  on activity_listing.id = pa.project_id
                where pa.actor_id = p.user_id
                  and (
                    activity_listing.created_by = auth.uid()
                    or exists (
                      select 1
                      from public.applications activity_viewer_membership
                      where activity_viewer_membership.listing_id = activity_listing.id
                        and activity_viewer_membership.user_id = auth.uid()
                        and activity_viewer_membership.status = 'accepted'
                    )
                  )
              )
            )
          )
        )
    );
$function$;

create or replace function public.cancel_project_file_upload_secure (
  p_expected_user_id uuid,
  p_reservation_id   uuid
)
  returns boolean
  language plpgsql
  security definer
  set search_path to 'public', 'storage', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_file_path text;
begin
  if v_user_id is null then
    raise exception 'Для отмены загрузки требуется авторизация.';
  end if;

  if p_expected_user_id is null
     or p_expected_user_id is distinct from v_user_id then
    raise exception 'user_id не совпадает с текущим пользователем.';
  end if;

  if exists (
    select 1
    from public.project_files pf
    where pf.upload_reservation_id = p_reservation_id
      and pf.uploaded_by = v_user_id
  ) then
    return false;
  end if;

  select r.file_path
    into v_file_path
  from public.project_file_upload_reservations r
  where r.id = p_reservation_id
    and r.user_id = v_user_id
  for update;

  if not found then
    return false;
  end if;

  if exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'project-files'
      and o.name = v_file_path
  ) then
    raise exception
      'Сначала удалите загруженный объект из Storage.';
  end if;

  delete from public.project_file_upload_reservations
  where id = p_reservation_id
    and user_id = v_user_id;

  return true;
end
$function$;

create or replace function public.create_notification_secure (
  p_recipient_id      uuid,
  p_expected_actor_id uuid,
  p_project_id        uuid  default null::uuid,
  p_type              text  default null::text,
  p_title             text  default null::text,
  p_body              text  default null::text,
  p_href              text  default null::text,
  p_payload           jsonb default '{}'::jsonb
)
  returns table (
    notification_id uuid,
    skipped         boolean
  )
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_category text;
  v_pref_value jsonb;
  v_enabled boolean := true;
  v_allowed boolean := false;
  v_inserted_id uuid;
  v_recent_count integer;
  v_entity_key text;

  v_task_id uuid;
  v_auction_id uuid;
  v_bid_id uuid;
  v_access_request_id uuid;
  v_contribution_id uuid;
  v_file_path text;
begin
  -- -------------------------------------------------------------------------
  -- Базовая валидация
  -- -------------------------------------------------------------------------

  if v_actor_id is null then
    raise exception 'Для создания уведомления требуется авторизация.';
  end if;

  if p_expected_actor_id is null
     or p_expected_actor_id is distinct from v_actor_id then
    raise exception 'actor_id не совпадает с текущим пользователем.';
  end if;

  if p_recipient_id is null then
    raise exception 'recipient_id обязателен.';
  end if;

  if p_recipient_id = v_actor_id then
    raise exception 'Нельзя создать внутреннее уведомление самому себе.';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.user_id = p_recipient_id
  ) then
    raise exception 'Получатель уведомления не найден.';
  end if;

  p_type := btrim(coalesce(p_type, ''));
  p_title := btrim(coalesce(p_title, ''));

  if p_type = '' then
    raise exception 'Тип уведомления обязателен.';
  end if;

  if p_title = '' then
    raise exception 'Заголовок уведомления обязателен.';
  end if;

  if char_length(p_type) > 80 then
    raise exception 'Тип уведомления слишком длинный.';
  end if;

  if char_length(p_title) > 180 then
    raise exception 'Заголовок уведомления слишком длинный.';
  end if;

  if p_body is not null and char_length(p_body) > 2000 then
    raise exception 'Текст уведомления слишком длинный.';
  end if;

  if p_href is not null then
    if char_length(p_href) > 500 then
      raise exception 'Ссылка уведомления слишком длинная.';
    end if;

    if not p_href like '/%' or p_href like '//%' then
      raise exception 'Разрешены только внутренние ссылки.';
    end if;
  end if;

  p_payload := coalesce(p_payload, '{}'::jsonb);

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload должен быть JSON-объектом.';
  end if;

  if octet_length(p_payload::text) > 16384 then
    raise exception 'payload уведомления слишком большой.';
  end if;

  if p_type not in (
    'project_application',
    'project_invite',
    'application_accepted',
    'application_declined',
    'participant_removed',
    'participant_left',

    'task_assigned',
    'task_completed',
    'task_done',
    'task_deadline_changed',
    'task_excuse_submitted',
    'task_excuse_decided',

    'project_file_uploaded',
    'contribution_verified',
    'profile_review_created',

    'auction_new_bid',
    'auction_bid_accepted',
    'auction_bid_rejected',
    'auction_access_requested',
    'auction_access_approved',
    'auction_access_rejected'
  ) then
    raise exception 'Недопустимый тип уведомления: %', p_type;
  end if;

  -- -------------------------------------------------------------------------
  -- Извлечение идентификаторов payload
  -- Невалидный UUID приводит к отказу RPC, а не к созданию записи.
  -- -------------------------------------------------------------------------

  if nullif(p_payload ->> 'task_id', '') is not null then
    v_task_id := (p_payload ->> 'task_id')::uuid;
  end if;

  if nullif(p_payload ->> 'auction_id', '') is not null then
    v_auction_id := (p_payload ->> 'auction_id')::uuid;
  end if;

  if nullif(p_payload ->> 'bid_id', '') is not null then
    v_bid_id := (p_payload ->> 'bid_id')::uuid;
  end if;

  if nullif(p_payload ->> 'access_request_id', '') is not null then
    v_access_request_id := (p_payload ->> 'access_request_id')::uuid;
  end if;

  if nullif(p_payload ->> 'contribution_id', '') is not null then
    v_contribution_id := (p_payload ->> 'contribution_id')::uuid;
  end if;

  v_file_path := nullif(p_payload ->> 'file_path', '');

  -- -------------------------------------------------------------------------
  -- Проверка бизнес-контекста по типу
  -- -------------------------------------------------------------------------

  case p_type
    -- Проекты / отклики -------------------------------------------------------

    when 'project_application' then
      v_allowed :=
        p_project_id is not null
        and exists (
          select 1
          from public.listings l
          where l.id = p_project_id
            and l.created_by = p_recipient_id
        )
        and exists (
          select 1
          from public.applications a
          where a.listing_id = p_project_id
            and a.user_id = v_actor_id
            and coalesce(a.invited_by_author, false) = false
            and a.status = 'pending'
        );

    when 'project_invite' then
      v_allowed :=
        p_project_id is not null
        and public.is_listing_owner(p_project_id)
        and exists (
          select 1
          from public.applications a
          where a.listing_id = p_project_id
            and a.user_id = p_recipient_id
            and coalesce(a.invited_by_author, false) = true
            and a.status = 'pending'
        );

    when 'application_accepted' then
      v_allowed :=
        p_project_id is not null
        and public.is_listing_owner(p_project_id)
        and exists (
          select 1
          from public.applications a
          where a.listing_id = p_project_id
            and a.user_id = p_recipient_id
            and a.status = 'accepted'
        );

    when 'application_declined' then
      v_allowed :=
        p_project_id is not null
        and public.is_listing_owner(p_project_id)
        and exists (
          select 1
          from public.applications a
          where a.listing_id = p_project_id
            and a.user_id = p_recipient_id
            and a.status in ('declined', 'rejected')
        );

    when 'participant_removed' then
      v_allowed :=
        p_project_id is not null
        and public.is_listing_owner(p_project_id)
        and exists (
          select 1
          from public.applications a
          where a.listing_id = p_project_id
            and a.user_id = p_recipient_id
            and a.status = 'removed'
        );

    when 'participant_left' then
      v_allowed :=
        p_project_id is not null
        and exists (
          select 1
          from public.listings l
          where l.id = p_project_id
            and l.created_by = p_recipient_id
        )
        and exists (
          select 1
          from public.applications a
          where a.listing_id = p_project_id
            and a.user_id = v_actor_id
            and a.status = 'left'
        );

    -- Задачи ------------------------------------------------------------------

    when 'task_assigned' then
      v_allowed :=
        p_project_id is not null
        and public.is_project_member(p_project_id, v_actor_id)
        and public.is_project_member(p_project_id, p_recipient_id)
        and (
          (
            v_task_id is not null
            and exists (
              select 1
              from public.tasks t
              where t.id = v_task_id
                and t.project_id = p_project_id
                and t.assignee_id = p_recipient_id
            )
          )
          or
          (
            v_task_id is null
            and nullif(p_payload ->> 'task_title', '') is not null
            and exists (
              select 1
              from public.tasks t
              where t.project_id = p_project_id
                and t.assignee_id = p_recipient_id
                and t.title = p_payload ->> 'task_title'
                and t.created_at >= now() - interval '5 minutes'
            )
          )
        );

    when 'task_completed', 'task_done' then
      v_allowed :=
        p_project_id is not null
        and v_task_id is not null
        and public.is_project_member(p_project_id, v_actor_id)
        and exists (
          select 1
          from public.listings l
          where l.id = p_project_id
            and l.created_by = p_recipient_id
        )
        and exists (
          select 1
          from public.tasks t
          where t.id = v_task_id
            and t.project_id = p_project_id
            and t.status = 'done'
        );

    when 'task_deadline_changed' then
      v_allowed :=
        p_project_id is not null
        and v_task_id is not null
        and public.is_project_member(p_project_id, v_actor_id)
        and exists (
          select 1
          from public.tasks t
          where t.id = v_task_id
            and t.project_id = p_project_id
            and t.assignee_id = p_recipient_id
        );

    when 'task_excuse_submitted' then
      v_allowed :=
        p_project_id is not null
        and v_task_id is not null
        and exists (
          select 1
          from public.listings l
          where l.id = p_project_id
            and l.created_by = p_recipient_id
        )
        and exists (
          select 1
          from public.tasks t
          where t.id = v_task_id
            and t.project_id = p_project_id
            and t.assignee_id = v_actor_id
        );

    when 'task_excuse_decided' then
      v_allowed :=
        p_project_id is not null
        and v_task_id is not null
        and public.is_listing_owner(p_project_id)
        and exists (
          select 1
          from public.tasks t
          where t.id = v_task_id
            and t.project_id = p_project_id
            and t.assignee_id = p_recipient_id
        );

    -- Файлы / вклад / отзывы --------------------------------------------------

    when 'project_file_uploaded' then
      v_allowed :=
        p_project_id is not null
        and v_file_path is not null
        and public.is_project_member(p_project_id, v_actor_id)
        and public.is_project_member(p_project_id, p_recipient_id)
        and exists (
          select 1
          from public.project_files pf
          where pf.project_id = p_project_id
            and pf.file_path = v_file_path
            and pf.uploaded_by = v_actor_id
        );

    when 'contribution_verified' then
      v_allowed :=
        p_project_id is not null
        and v_contribution_id is not null
        and public.is_listing_owner(p_project_id)
        and exists (
          select 1
          from public.contributions c
          where c.id = v_contribution_id
            and c.project_id = p_project_id
            and c.user_id = p_recipient_id
            and c.verified_by = v_actor_id
        );

    when 'profile_review_created' then
      v_allowed :=
        p_project_id is not null
        and exists (
          select 1
          from public.profile_reviews r
          where r.project_id = p_project_id
            and r.reviewer_id = v_actor_id
            and r.reviewed_user_id = p_recipient_id
        );

    -- Аукционы ----------------------------------------------------------------

    when 'auction_new_bid' then
      v_allowed :=
        v_auction_id is not null
        and exists (
          select 1
          from public.auctions a
          where a.id = v_auction_id
            and a.owner_id = p_recipient_id
            and (
              p_project_id is null
              or a.linked_listing_id = p_project_id
            )
        )
        and exists (
          select 1
          from public.auction_bids b
          where b.auction_id = v_auction_id
            and b.bidder_id = v_actor_id
            and b.status in ('new', 'shortlisted')
        );

    when 'auction_bid_accepted' then
      v_allowed :=
        v_auction_id is not null
        and v_bid_id is not null
        and exists (
          select 1
          from public.auctions a
          where a.id = v_auction_id
            and a.owner_id = v_actor_id
            and (
              p_project_id is null
              or a.linked_listing_id = p_project_id
            )
        )
        and exists (
          select 1
          from public.auction_bids b
          where b.id = v_bid_id
            and b.auction_id = v_auction_id
            and b.bidder_id = p_recipient_id
            and b.status = 'accepted'
        );

    when 'auction_bid_rejected' then
      v_allowed :=
        v_auction_id is not null
        and v_bid_id is not null
        and exists (
          select 1
          from public.auctions a
          where a.id = v_auction_id
            and a.owner_id = v_actor_id
            and (
              p_project_id is null
              or a.linked_listing_id = p_project_id
            )
        )
        and exists (
          select 1
          from public.auction_bids b
          where b.id = v_bid_id
            and b.auction_id = v_auction_id
            and b.bidder_id = p_recipient_id
            and b.status = 'rejected'
        );

    when 'auction_access_requested' then
      v_allowed :=
        v_auction_id is not null
        and exists (
          select 1
          from public.auctions a
          where a.id = v_auction_id
            and a.owner_id = p_recipient_id
            and (
              p_project_id is null
              or a.linked_listing_id = p_project_id
            )
        )
        and exists (
          select 1
          from public.auction_access_requests r
          where r.auction_id = v_auction_id
            and r.requester_id = v_actor_id
            and r.status = 'pending'
        );

    when 'auction_access_approved' then
      v_allowed :=
        v_auction_id is not null
        and v_access_request_id is not null
        and exists (
          select 1
          from public.auctions a
          where a.id = v_auction_id
            and a.owner_id = v_actor_id
            and (
              p_project_id is null
              or a.linked_listing_id = p_project_id
            )
        )
        and exists (
          select 1
          from public.auction_access_requests r
          where r.id = v_access_request_id
            and r.auction_id = v_auction_id
            and r.requester_id = p_recipient_id
            and r.status = 'approved'
        );

    when 'auction_access_rejected' then
      v_allowed :=
        v_auction_id is not null
        and v_access_request_id is not null
        and exists (
          select 1
          from public.auctions a
          where a.id = v_auction_id
            and a.owner_id = v_actor_id
            and (
              p_project_id is null
              or a.linked_listing_id = p_project_id
            )
        )
        and exists (
          select 1
          from public.auction_access_requests r
          where r.id = v_access_request_id
            and r.auction_id = v_auction_id
            and r.requester_id = p_recipient_id
            and r.status = 'rejected'
        );
  end case;

  if not v_allowed then
    raise exception
      'Контекст уведомления не подтверждён политиками платформы.';
  end if;

  -- -------------------------------------------------------------------------
  -- Настройки получателя
  -- -------------------------------------------------------------------------

  v_category :=
    case
      when p_type like 'task\_%' escape '\' then 'tasks'
      when p_type like 'auction\_%' escape '\' then 'auctions'
      when p_type = 'profile_review_created' then 'reviews'
      when p_type = 'project_file_uploaded' then 'files'
      when p_type = 'project_invite' then 'invitations'
      else 'projects'
    end;

  select us.notification_prefs -> v_category
    into v_pref_value
  from public.user_settings us
  where us.user_id = p_recipient_id;

  if v_pref_value is not null
     and jsonb_typeof(v_pref_value) = 'boolean' then
    v_enabled := (v_pref_value #>> '{}')::boolean;
  end if;

  if not v_enabled then
    return query
    select null::uuid, true;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Антиспам и защита от двойного сабмита
  -- -------------------------------------------------------------------------

  select count(*)
    into v_recent_count
  from public.notifications n
  where n.actor_id = v_actor_id
    and n.created_at >= now() - interval '1 minute';

  if v_recent_count >= 60 then
    raise exception
      'Слишком много уведомлений за короткое время. Повторите позже.';
  end if;

  v_entity_key :=
    coalesce(
      p_payload ->> 'access_request_id',
      p_payload ->> 'bid_id',
      p_payload ->> 'task_id',
      p_payload ->> 'contribution_id',
      p_payload ->> 'file_path',
      p_payload ->> 'auction_id',
      p_payload ->> 'listing_id',
      p_project_id::text,
      p_type
    );

  if exists (
    select 1
    from public.notifications n
    where n.actor_id = v_actor_id
      and n.recipient_id = p_recipient_id
      and n.type = p_type
      and n.project_id is not distinct from p_project_id
      and n.created_at >= now() - interval '15 seconds'
      and coalesce(
        n.payload ->> 'access_request_id',
        n.payload ->> 'bid_id',
        n.payload ->> 'task_id',
        n.payload ->> 'contribution_id',
        n.payload ->> 'file_path',
        n.payload ->> 'auction_id',
        n.payload ->> 'listing_id',
        n.project_id::text,
        n.type
      ) = v_entity_key
  ) then
    return query
    select null::uuid, true;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- Создание
  -- -------------------------------------------------------------------------

  insert into public.notifications (
    recipient_id,
    actor_id,
    project_id,
    type,
    title,
    body,
    href,
    payload
  )
  values (
    p_recipient_id,
    v_actor_id,
    p_project_id,
    p_type,
    p_title,
    p_body,
    p_href,
    p_payload
  )
  returning id into v_inserted_id;

  return query
  select v_inserted_id, false;
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
    raise exception 'Только владелец аукциона может рассматривать запрос.';
  end if;

  if v_auction.type <> 'offer' then
    raise exception 'Запрос относится не к offer-аукциону.';
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
          'Вам открыли закрытые материалы аукциона «%s».',
          v_auction.title
        )
      else format(
        'Ваш запрос доступа к материалам аукциона «%s» отклонён.',
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

create or replace function public.delete_project_file_record_secure (
  p_expected_user_id uuid,
  p_file_id          uuid
)
  returns table (
    deleted_file_id   uuid,
    deleted_file_path text,
    deleted_file_name text
  )
  language plpgsql
  security definer
  set search_path to 'public', 'storage', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_file public.project_files%rowtype;
begin
  if v_user_id is null then
    raise exception 'Для удаления файла требуется авторизация.';
  end if;

  if p_expected_user_id is null
     or p_expected_user_id is distinct from v_user_id then
    raise exception 'user_id не совпадает с текущим пользователем.';
  end if;

  select pf.*
    into v_file
  from public.project_files pf
  where pf.id = p_file_id
  for update;

  if not found then
    return;
  end if;

  if v_file.uploaded_by is distinct from v_user_id
     and not public.project_file_is_owner(v_file.project_id, v_user_id) then
    raise exception
      'Удалять файл может загрузивший его пользователь или автор проекта.';
  end if;

  if exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'project-files'
      and o.name = v_file.file_path
  ) then
    raise exception
      'Объект ещё существует в Storage. Сначала удалите объект.';
  end if;

  delete from public.project_files
  where id = v_file.id;

  return query
  select v_file.id, v_file.file_path, v_file.file_name;
end
$function$;

create or replace function public.finalize_project_file_upload_secure (
  p_expected_user_id uuid,
  p_reservation_id   uuid
)
  returns table (
    project_file_id uuid
  )
  language plpgsql
  security definer
  set search_path to 'public', 'storage', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.project_file_upload_reservations%rowtype;
  v_existing_id uuid;
  v_project_file_id uuid;
begin
  if v_user_id is null then
    raise exception 'Для завершения загрузки требуется авторизация.';
  end if;

  if p_expected_user_id is null
     or p_expected_user_id is distinct from v_user_id then
    raise exception 'user_id не совпадает с текущим пользователем.';
  end if;

  -- Идемпотентность при повторном вызове после сетевой ошибки.
  select pf.id
    into v_existing_id
  from public.project_files pf
  where pf.upload_reservation_id = p_reservation_id
    and pf.uploaded_by = v_user_id;

  if found then
    return query select v_existing_id;
    return;
  end if;

  select r.*
    into v_reservation
  from public.project_file_upload_reservations r
  where r.id = p_reservation_id
    and r.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Резервация загрузки не найдена.';
  end if;

  if not public.project_file_is_member(
    v_reservation.project_id,
    v_user_id
  ) then
    raise exception 'Доступ к проекту был отозван.';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'project-files'
      and o.name = v_reservation.file_path
      and o.owner_id = v_user_id::text
  ) then
    raise exception
      'Объект не найден в Storage или принадлежит другому пользователю.';
  end if;

  insert into public.project_files (
    project_id,
    uploaded_by,
    file_name,
    file_path,
    file_size,
    mime_type,
    category,
    description,
    version_label,
    task_id,
    upload_reservation_id
  )
  values (
    v_reservation.project_id,
    v_user_id,
    v_reservation.file_name,
    v_reservation.file_path,
    v_reservation.file_size,
    v_reservation.mime_type,
    v_reservation.category,
    v_reservation.description,
    v_reservation.version_label,
    v_reservation.task_id,
    v_reservation.id
  )
  returning id into v_project_file_id;

  delete from public.project_file_upload_reservations
  where id = v_reservation.id;

  return query
  select v_project_file_id;
end
$function$;

create or replace function public.guard_application_update()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  -- Связь application с пользователем и listing неизменяема.
  if new.listing_id is distinct from old.listing_id
     or new.user_id is distinct from old.user_id then
    raise exception
      'Нельзя изменять listing_id или user_id существующего отклика/приглашения.';
  end if;

  -- Миграции/служебные операции могут менять статус,
  -- но не идентичность строки.
  if current_user in ('postgres', 'service_role', 'supabase_admin') then
    return new;
  end if;

  -- Владелец проекта управляет статусом отклика и приглашением.
  if public.is_listing_owner(old.listing_id) then
    return new;
  end if;

  if auth.uid() is distinct from old.user_id then
    raise exception 'Недостаточно прав для изменения отклика.';
  end if;

  -- Пользователь не может сам превратить обычный отклик в приглашение.
  if coalesce(old.invited_by_author, false) = false
     and coalesce(new.invited_by_author, false) = true then
    raise exception
      'Пользователь не может самостоятельно отметить отклик как приглашение автора.';
  end if;

  -- Самопринятие разрешено только для настоящего pending-приглашения автора.
  if new.status = 'accepted' then
    if not (
      coalesce(old.invited_by_author, false) = true
      and old.status = 'pending'
      and coalesce(new.invited_by_author, false) = true
    ) then
      raise exception
        'Обычный отклик нельзя принять самостоятельно. Решение принимает автор проекта.';
    end if;
  end if;

  -- Повторная самостоятельная заявка всегда становится обычным откликом,
  -- а не приглашением автора.
  if new.status = 'pending'
     and coalesce(new.invited_by_author, false) = true then
    raise exception
      'Повторный отклик пользователя не может сохранять признак приглашения автора.';
  end if;

  return new;
end
$function$;

create or replace function public.guard_auction_access_request_update()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if new.auction_id is distinct from old.auction_id
     or new.requester_id is distinct from old.requester_id then
    raise exception
      'Нельзя изменять auction_id или requester_id запроса доступа.';
  end if;

  if current_user not in (
    'postgres',
    'service_role',
    'supabase_admin'
  ) then
    raise exception
      'Решение по доступу выполняется только через защищённый RPC.';
  end if;

  return new;
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
      'Нельзя изменять auction_id или bidder_id существующей ставки.';
  end if;

  if current_user not in (
    'postgres',
    'service_role',
    'supabase_admin'
  ) then
    raise exception
      'Изменение ставки выполняется только через защищённый RPC.';
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
    raise exception 'Финальный статус аукциона нельзя изменить.';
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

create or replace function public.guard_project_file_row()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
       or new.uploaded_by is distinct from old.uploaded_by
       or new.file_path is distinct from old.file_path
       or new.upload_reservation_id is distinct from old.upload_reservation_id then
      raise exception
        'project_id, uploaded_by, file_path и upload_reservation_id нельзя изменять.';
    end if;
  end if;

  if new.file_path is null
     or split_part(new.file_path, '/', 1) <> new.project_id::text
     or array_length(regexp_split_to_array(new.file_path, '/'), 1) <> 2
     or split_part(new.file_path, '/', 2) in ('', '.', '..') then
    raise exception
      'file_path должен иметь формат project_id/filename.';
  end if;

  if char_length(new.file_path) > 500 then
    raise exception 'file_path слишком длинный.';
  end if;

  if new.file_name is null
     or btrim(new.file_name) = ''
     or char_length(new.file_name) > 255 then
    raise exception 'Некорректное имя файла.';
  end if;

  if new.file_size is not null
     and (new.file_size < 0 or new.file_size > 524288000) then
    raise exception 'Размер файла превышает лимит 500 МиБ.';
  end if;

  if new.task_id is not null
     and not exists (
       select 1
       from public.tasks t
       where t.id = new.task_id
         and t.project_id = new.project_id
     ) then
    raise exception 'Задача файла относится к другому проекту.';
  end if;

  return new;
end
$function$;

create or replace function public.has_listing_relation (
  p_listing_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.applications a
      where a.listing_id = p_listing_id
        and a.user_id = auth.uid()
    );
$function$;

create or replace function public.has_valid_project_file_upload_reservation (
  p_file_path text
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.project_file_upload_reservations r
      where r.file_path = p_file_path
        and r.user_id = auth.uid()
        and r.expires_at > now()
        and public.project_file_is_member(r.project_id, auth.uid())
    );
$function$;

create or replace function public.insert_auction_decision_notification_internal (
  p_recipient_id uuid,
  p_actor_id     uuid,
  p_project_id   uuid,
  p_type         text,
  p_title        text,
  p_body         text,
  p_href         text,
  p_payload      jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_enabled boolean := true;
  v_entity_key text;
begin
  if p_type not in (
    'auction_new_bid',
    'auction_bid_accepted',
    'auction_bid_rejected',
    'auction_access_requested',
    'auction_access_approved',
    'auction_access_rejected'
  ) then
    raise exception 'Недопустимый внутренний тип уведомления.';
  end if;

  if p_recipient_id is null
     or p_actor_id is null
     or p_recipient_id = p_actor_id then
    return;
  end if;

  select case
    when jsonb_typeof(us.notification_prefs -> 'auctions') = 'boolean'
      then (us.notification_prefs ->> 'auctions')::boolean
    else true
  end
    into v_enabled
  from public.user_settings us
  where us.user_id = p_recipient_id;

  if coalesce(v_enabled, true) = false then
    return;
  end if;

  v_entity_key := coalesce(
    p_payload ->> 'access_request_id',
    p_payload ->> 'bid_id',
    p_payload ->> 'auction_id',
    p_type
  );

  insert into public.notifications (
    recipient_id,
    actor_id,
    project_id,
    type,
    title,
    body,
    href,
    payload
  )
  select
    p_recipient_id,
    p_actor_id,
    p_project_id,
    p_type,
    p_title,
    p_body,
    p_href,
    coalesce(p_payload, '{}'::jsonb)
  where not exists (
    select 1
    from public.notifications n
    where n.recipient_id = p_recipient_id
      and n.actor_id = p_actor_id
      and n.type = p_type
      and n.project_id is not distinct from p_project_id
      and coalesce(
        n.payload ->> 'access_request_id',
        n.payload ->> 'bid_id',
        n.payload ->> 'auction_id',
        n.type
      ) = v_entity_key
  );
end
$function$;

create or replace function public.is_listing_owner (
  p_listing_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.listings l
      where l.id = p_listing_id
        and l.created_by = auth.uid()
    );
$function$;

create or replace function public.is_project_member (
  p_project_id uuid,
  p_user_id    uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    p_project_id is not null
    and p_user_id is not null
    and (
      exists (
        select 1
        from public.listings l
        where l.id = p_project_id
          and l.created_by = p_user_id
      )
      or exists (
        select 1
        from public.applications a
        where a.listing_id = p_project_id
          and a.user_id = p_user_id
          and a.status = 'accepted'
      )
    );
$function$;

create or replace function public.phase8_current_user_is_project_member (
  p_project_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select public.phase8_is_project_member_internal(
    p_project_id,
    auth.uid()
  );
$function$;

create or replace function public.phase8_current_user_is_project_owner (
  p_project_id uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select public.phase8_is_project_owner_internal(
    p_project_id,
    auth.uid()
  );
$function$;

create or replace function public.phase8_guard_contribution_row()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_verification_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Нельзя переносить вклад в другой проект.';
    end if;

    if new.user_id is distinct from old.user_id then
      raise exception 'Нельзя менять автора вклада.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'Нельзя изменять дату создания вклада.';
    end if;

    v_verification_changed :=
      new.verified_by is distinct from old.verified_by
      or new.verified_at is distinct from old.verified_at;
  else
    v_verification_changed :=
      new.verified_by is not null
      or new.verified_at is not null;
  end if;

  if tg_op = 'INSERT'
     and not public.phase8_is_project_member_internal(
       new.project_id,
       new.user_id
     ) then
    raise exception
      'Автор вклада должен быть участником этого проекта.';
  end if;

  if new.task_id is not null
     and not exists (
       select 1
       from public.tasks as t
       where t.id = new.task_id
         and t.project_id = new.project_id
     ) then
    raise exception
      'Задача вклада относится к другому проекту.';
  end if;

  if (new.verified_by is null) <> (new.verified_at is null) then
    raise exception
      'verified_by и verified_at должны заполняться одновременно.';
  end if;

  if new.verified_by is not null
     and not public.phase8_is_project_owner_internal(
       new.project_id,
       new.verified_by
     ) then
    raise exception
      'Подтвердить вклад может только автор проекта.';
  end if;

  if v_actor_id is not null and v_verification_changed then
    if tg_op = 'INSERT' then
      raise exception
        'Новый вклад нельзя создать уже подтверждённым.';
    end if;

    if old.verified_by is not null then
      raise exception
        'Подтверждение вклада нельзя изменить или отменить.';
    end if;

    if not public.phase8_is_project_owner_internal(
      new.project_id,
      v_actor_id
    ) then
      raise exception
        'Подтвердить вклад может только автор проекта.';
    end if;

    if new.verified_by <> v_actor_id
       or new.verified_at is null then
      raise exception
        'verified_by должен совпадать с текущим пользователем.';
    end if;
  end if;

  return new;
end
$function$;

create or replace function public.phase8_guard_project_document_row()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Нельзя переносить документ в другой проект.';
    end if;

    if new.author_id is distinct from old.author_id then
      raise exception 'Нельзя менять автора документа.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'Нельзя изменять дату создания документа.';
    end if;
  end if;

  if tg_op = 'INSERT'
     and not public.phase8_is_project_member_internal(
       new.project_id,
       new.author_id
     ) then
    raise exception
      'Автор документа должен быть участником этого проекта.';
  end if;

  if new.title is null or btrim(new.title) = '' then
    raise exception 'Название документа не может быть пустым.';
  end if;

  return new;
end
$function$;

create or replace function public.phase8_guard_project_message_row()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Нельзя переносить сообщение в другой проект.';
    end if;

    if new.author_id is distinct from old.author_id then
      raise exception 'Нельзя менять автора сообщения.';
    end if;

    if new.parent_message_id is distinct from old.parent_message_id then
      raise exception 'Нельзя менять сообщение, на которое был дан ответ.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'Нельзя изменять дату создания сообщения.';
    end if;

    if old.is_deleted_for_all
       and (
         new.body is distinct from old.body
         or new.is_deleted_for_all is distinct from old.is_deleted_for_all
         or new.edited_at is distinct from old.edited_at
       ) then
      raise exception
        'Удалённое для всех сообщение нельзя восстановить или редактировать.';
    end if;
  end if;

  if tg_op = 'INSERT'
     and not public.phase8_is_project_member_internal(
       new.project_id,
       new.author_id
     ) then
    raise exception
      'Автор сообщения должен быть участником этого проекта.';
  end if;

  if new.parent_message_id is not null then
    if new.parent_message_id = new.id then
      raise exception 'Сообщение не может отвечать само на себя.';
    end if;

    if not exists (
      select 1
      from public.project_messages as parent
      where parent.id = new.parent_message_id
        and parent.project_id = new.project_id
    ) then
      raise exception
        'Ответ должен ссылаться на сообщение из того же проекта.';
    end if;
  end if;

  if new.is_deleted_for_all then
    if new.body <> '' then
      raise exception
        'Удалённое для всех сообщение не должно содержать текст.';
    end if;

    if new.edited_at is null then
      raise exception
        'При удалении сообщения требуется edited_at.';
    end if;
  else
    if new.body is null or btrim(new.body) = '' then
      raise exception 'Сообщение не может быть пустым.';
    end if;

    if tg_op = 'UPDATE'
       and new.body is distinct from old.body
       and new.edited_at is null then
      raise exception
        'При редактировании сообщения требуется edited_at.';
    end if;
  end if;

  return new;
end
$function$;

create or replace function public.phase8_guard_task_row()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_excuse_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'Нельзя переносить задачу в другой проект.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'Нельзя изменять дату создания задачи.';
    end if;

    v_excuse_changed :=
      new.excuse_reason is distinct from old.excuse_reason
      or new.excuse_status is distinct from old.excuse_status
      or new.excuse_decided_by is distinct from old.excuse_decided_by
      or new.excuse_decided_at is distinct from old.excuse_decided_at;
  else
    v_excuse_changed :=
      new.excuse_reason is not null
      or new.excuse_status is distinct from 'none'
      or new.excuse_decided_by is not null
      or new.excuse_decided_at is not null;
  end if;

  if tg_op = 'INSERT'
     or new.assignee_id is distinct from old.assignee_id then
    if new.assignee_id is not null
       and not public.phase8_is_project_member_internal(
         new.project_id,
         new.assignee_id
       ) then
      raise exception
        'Исполнитель задачи должен быть участником этого проекта.';
    end if;
  end if;

  if new.excuse_status not in (
    'none',
    'pending',
    'approved',
    'rejected'
  ) then
    raise exception 'Недопустимый статус уважительной причины.';
  end if;

  if new.excuse_status in ('none', 'pending')
     and (
       new.excuse_decided_by is not null
       or new.excuse_decided_at is not null
     ) then
    raise exception
      'Для none/pending поля решения должны быть пустыми.';
  end if;

  if new.excuse_status = 'pending'
     and (
       new.excuse_reason is null
       or btrim(new.excuse_reason) = ''
     ) then
    raise exception 'Для отправки причины требуется текст.';
  end if;

  if new.excuse_status in ('approved', 'rejected') then
    if new.excuse_reason is null
       or btrim(new.excuse_reason) = ''
       or new.excuse_decided_by is null
       or new.excuse_decided_at is null then
      raise exception 'Решение по причине заполнено не полностью.';
    end if;

    if not public.phase8_is_project_owner_internal(
      new.project_id,
      new.excuse_decided_by
    ) then
      raise exception
        'Решение по причине может принадлежать только автору проекта.';
    end if;
  end if;

  if v_actor_id is not null and v_excuse_changed then
    if new.excuse_status = 'pending' then
      if new.assignee_id is null
         or new.assignee_id <> v_actor_id then
        raise exception
          'Отправить уважительную причину может только исполнитель задачи.';
      end if;
    elsif new.excuse_status in ('approved', 'rejected') then
      if not public.phase8_is_project_owner_internal(
        new.project_id,
        v_actor_id
      ) then
        raise exception
          'Решение по причине может принять только автор проекта.';
      end if;

      if new.excuse_decided_by <> v_actor_id then
        raise exception
          'excuse_decided_by должен совпадать с текущим пользователем.';
      end if;
    else
      raise exception
        'Клиент не может сбрасывать состояние уважительной причины.';
    end if;
  end if;

  return new;
end
$function$;

create or replace function public.phase8_is_project_member_internal (
  p_project_id uuid,
  p_user_id    uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    p_project_id is not null
    and p_user_id is not null
    and (
      exists (
        select 1
        from public.listings as l
        where l.id = p_project_id
          and l.created_by = p_user_id
      )
      or exists (
        select 1
        from public.applications as a
        where a.listing_id = p_project_id
          and a.user_id = p_user_id
          and a.status = 'accepted'
      )
    );
$function$;

create or replace function public.phase8_is_project_owner_internal (
  p_project_id uuid,
  p_user_id    uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    p_project_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.listings as l
      where l.id = p_project_id
        and l.created_by = p_user_id
    );
$function$;

create or replace function public.prevent_identity_columns_update()
  returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  argument_index integer;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_nargs > 0 then
    for argument_index in 0..tg_nargs - 1 loop
      if (new_row -> tg_argv[argument_index])
         is distinct from
         (old_row -> tg_argv[argument_index]) then
        raise exception
          'Поле % нельзя изменять после создания записи.',
          tg_argv[argument_index];
      end if;
    end loop;
  end if;

  return new;
end
$function$;

create or replace function public.project_activity_profile_name (
  p_user_id uuid
)
  returns text
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select coalesce(
    nullif(btrim(p.display_name), ''),
    'Участник проекта'
  )
  from public.profiles p
  where p.user_id = p_user_id;
$function$;

create or replace function public.project_file_is_member (
  p_project_id uuid,
  p_user_id    uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    p_project_id is not null
    and p_user_id is not null
    and (
      exists (
        select 1
        from public.listings l
        where l.id = p_project_id
          and l.created_by = p_user_id
      )
      or exists (
        select 1
        from public.applications a
        where a.listing_id = p_project_id
          and a.user_id = p_user_id
          and a.status = 'accepted'
      )
    );
$function$;

create or replace function public.project_file_is_owner (
  p_project_id uuid,
  p_user_id    uuid
)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select
    p_project_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.listings l
      where l.id = p_project_id
        and l.created_by = p_user_id
    );
$function$;

create or replace function public.project_file_project_id_from_path (
  p_file_path text
)
  returns uuid
  language plpgsql
  immutable
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if p_file_path is null
     or array_length(regexp_split_to_array(p_file_path, '/'), 1) <> 2 then
    return null;
  end if;

  return split_part(p_file_path, '/', 1)::uuid;
exception
  when others then
    return null;
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
    raise exception 'Аукцион не найден.';
  end if;

  if v_auction.type <> 'offer' then
    raise exception 'Закрытые материалы доступны только у offer-аукциона.';
  end if;

  if v_auction.owner_id = v_requester_id then
    raise exception 'Владелец уже имеет доступ к материалам.';
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Запросить доступ можно только у открытого аукциона.';
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
      'Пользователь запросил доступ к закрытой части аукциона «%s».',
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

create or replace function public.reserve_project_file_upload_secure (
  p_expected_user_id uuid,
  p_project_id       uuid,
  p_file_name        text,
  p_file_size        bigint,
  p_mime_type        text   default null::text,
  p_category         text   default 'other'::text,
  p_description      text   default null::text,
  p_version_label    text   default null::text,
  p_task_id          uuid   default null::uuid
)
  returns table (
    reservation_id uuid,
    file_path      text
  )
  language plpgsql
  security definer
  set search_path to 'public', 'storage', 'pg_temp'
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_safe_file_name text;
  v_file_path text;
  v_reservation_id uuid;
  v_active_count integer;
begin
  if v_user_id is null then
    raise exception 'Для загрузки файла требуется авторизация.';
  end if;

  if p_expected_user_id is null
     or p_expected_user_id is distinct from v_user_id then
    raise exception 'user_id не совпадает с текущим пользователем.';
  end if;

  if not public.project_file_is_member(p_project_id, v_user_id) then
    raise exception 'Нет доступа к загрузке файлов в этот проект.';
  end if;

  if p_file_size is null
     or p_file_size <= 0
     or p_file_size > 524288000 then
    raise exception 'Размер файла должен быть от 1 байта до 500 МиБ.';
  end if;

  if p_file_name is null or btrim(p_file_name) = '' then
    raise exception 'Имя файла обязательно.';
  end if;

  if char_length(p_file_name) > 255 then
    raise exception 'Имя файла слишком длинное.';
  end if;

  if p_mime_type is not null and char_length(p_mime_type) > 255 then
    raise exception 'MIME-тип слишком длинный.';
  end if;

  if p_category not in (
    'document',
    'drawing',
    'cad',
    'code',
    'image',
    'archive',
    'report',
    'presentation',
    'other'
  ) then
    raise exception 'Недопустимая категория файла.';
  end if;

  if p_description is not null and char_length(p_description) > 4000 then
    raise exception 'Описание файла слишком длинное.';
  end if;

  if p_version_label is not null and char_length(p_version_label) > 80 then
    raise exception 'Метка версии слишком длинная.';
  end if;

  if p_task_id is not null
     and not exists (
       select 1
       from public.tasks t
       where t.id = p_task_id
         and t.project_id = p_project_id
     ) then
    raise exception 'Выбранная задача относится к другому проекту.';
  end if;

  -- Удаляем только истёкшие резервации, для которых объект так и не появился.
  delete from public.project_file_upload_reservations r
  where r.user_id = v_user_id
    and r.expires_at < now()
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'project-files'
        and o.name = r.file_path
    );

  select count(*)
    into v_active_count
  from public.project_file_upload_reservations r
  where r.user_id = v_user_id
    and r.expires_at > now();

  if v_active_count >= 20 then
    raise exception
      'Слишком много незавершённых загрузок. Завершите или отмените предыдущие.';
  end if;

  v_safe_file_name := regexp_replace(
    btrim(p_file_name),
    E'[/\\\\?%*:|"<>]+',
    '_',
    'g'
  );
  v_safe_file_name := regexp_replace(
    v_safe_file_name,
    '[[:cntrl:]]+',
    '_',
    'g'
  );
  v_safe_file_name := regexp_replace(
    v_safe_file_name,
    '^[. ]+',
    '',
    'g'
  );
  v_safe_file_name := left(v_safe_file_name, 180);

  if btrim(v_safe_file_name) = '' then
    v_safe_file_name := 'file';
  end if;

  v_file_path :=
    p_project_id::text
    || '/'
    || gen_random_uuid()::text
    || '-'
    || v_safe_file_name;

  insert into public.project_file_upload_reservations (
    project_id,
    user_id,
    file_path,
    file_name,
    file_size,
    mime_type,
    category,
    description,
    version_label,
    task_id
  )
  values (
    p_project_id,
    v_user_id,
    v_file_path,
    p_file_name,
    p_file_size,
    nullif(btrim(coalesce(p_mime_type, '')), ''),
    p_category,
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_version_label, '')), ''),
    p_task_id
  )
  returning id into v_reservation_id;

  return query
  select v_reservation_id, v_file_path;
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
    raise exception 'Только владелец аукциона может менять статус ставки.';
  end if;

  if v_bid.status = p_target_status then
    return query select v_bid.id, v_bid.status, true;
    return;
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Решения можно принимать только в открытом аукционе.';
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
        'Ваше предложение по аукциону «%s» отклонено.',
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
    raise exception 'Аукцион не найден.';
  end if;

  if v_auction.owner_id = v_bidder_id then
    raise exception 'Нельзя подать предложение на собственный аукцион.';
  end if;

  if v_auction.status <> 'open' then
    raise exception 'Аукцион не принимает предложения.';
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
        when v_resumed then 'Повторное предложение на аукцион'
        else 'Новое предложение на аукцион'
      end,
      case
        when v_resumed
          then format(
            'На аукцион «%s» повторно подали предложение.',
            v_auction.title
          )
        else format(
          'На аукцион «%s» подали новое предложение.',
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

create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
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
    raise exception 'Недопустимый целевой статус аукциона.';
  end if;

  select a.*
    into v_auction
  from public.auctions as a
  where a.id = p_auction_id
  for update;

  if not found then
    raise exception 'Аукцион не найден.';
  end if;

  if v_auction.owner_id is distinct from v_owner_id then
    raise exception 'Только владелец может менять статус аукциона.';
  end if;

  if v_auction.status = p_target_status then
    return query
    select v_auction.id, v_auction.status, true;
    return;
  end if;

  if v_auction.status in ('closed', 'cancelled') then
    raise exception 'Финальный статус аукциона нельзя изменить.';
  end if;

  if p_target_status = 'closed'
     and v_auction.status <> 'open' then
    raise exception 'Закрыть можно только открытый аукцион.';
  end if;

  if p_target_status = 'cancelled'
     and v_auction.status not in ('draft', 'open') then
    raise exception 'Отменить можно только черновик или открытый аукцион.';
  end if;

  if exists (
    select 1
    from public.auction_bids as b
    where b.auction_id = v_auction.id
      and b.status = 'accepted'
  ) then
    raise exception
      'Аукцион с принятым предложением закрывается только процедурой принятия победителя.';
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
          then 'Аукцион отменён'
        else 'Аукцион закрыт'
      end,
      case
        when p_target_status = 'cancelled'
          then format(
            'Аукцион «%s» отменён владельцем.',
            v_auction.title
          )
        else format(
          'Аукцион «%s» закрыт без выбора предложения.',
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

create or replace function public.trusted_activity_from_contribution()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_author_name text;
begin
  if tg_op = 'INSERT' then
    perform public.append_project_activity_internal(
      new.project_id,
      'contribution_added',
      format('Добавлен вклад «%s»', new.title),
      format(
        'Тип: %s%s.',
        coalesce(new.kind, 'other'),
        case
          when new.hours is null then ''
          else format(' · %s ч', new.hours)
        end
      ),
      'contribution',
      new.id,
      jsonb_build_object(
        'contribution_id', new.id,
        'user_id', new.user_id,
        'task_id', new.task_id,
        'kind', new.kind,
        'title', new.title,
        'hours', new.hours
      )
    );

    return new;
  end if;

  if new.verified_by is not null
     and old.verified_by is null then
    v_author_name := public.project_activity_profile_name(new.user_id);

    perform public.append_project_activity_internal(
      new.project_id,
      'contribution_verified',
      format('Подтверждён вклад «%s»', new.title),
      format(
        'Автор вклада: %s.',
        coalesce(v_author_name, 'Участник проекта')
      ),
      'contribution',
      new.id,
      jsonb_build_object(
        'contribution_id', new.id,
        'user_id', new.user_id,
        'verified_by', new.verified_by,
        'verified_at', new.verified_at,
        'task_id', new.task_id
      )
    );
  end if;

  return new;
end
$function$;

create or replace function public.trusted_activity_from_profile_review()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_target_name text;
begin
  if tg_op = 'UPDATE'
     and new.rating is not distinct from old.rating
     and new.text is not distinct from old.text then
    return new;
  end if;

  v_target_name := public.project_activity_profile_name(
    new.reviewed_user_id
  );

  perform public.append_project_activity_internal(
    new.project_id,
    case
      when tg_op = 'INSERT' then 'profile_review_created'
      else 'profile_review_updated'
    end,
    case
      when tg_op = 'INSERT' then 'Добавлен отзыв'
      else 'Отзыв обновлён'
    end,
    format(
      'Отзыв для %s. Оценка: %s/5.',
      coalesce(v_target_name, 'участника проекта'),
      new.rating
    ),
    'profile_review',
    new.id,
    jsonb_build_object(
      'review_id', new.id,
      'reviewer_id', new.reviewer_id,
      'reviewed_user_id', new.reviewed_user_id,
      'rating', new.rating,
      'previous_rating', case
        when tg_op = 'UPDATE' then old.rating
        else null
      end
    )
  );

  return new;
end
$function$;

create or replace function public.trusted_activity_from_project_file()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
begin
  if tg_op = 'INSERT' then
    perform public.append_project_activity_internal(
      new.project_id,
      'file_uploaded',
      format('Загружен файл «%s»', new.file_name),
      format('Категория: %s.', coalesce(new.category, 'other')),
      'project_file',
      new.id,
      jsonb_build_object(
        'file_id', new.id,
        'file_name', new.file_name,
        'file_path', new.file_path,
        'category', new.category,
        'task_id', new.task_id,
        'uploaded_by', new.uploaded_by
      )
    );

    return new;
  end if;

  perform public.append_project_activity_internal(
    old.project_id,
    'file_deleted',
    format('Удалён файл «%s»', old.file_name),
    null,
    'project_file',
    old.id,
    jsonb_build_object(
      'file_id', old.id,
      'file_name', old.file_name,
      'file_path', old.file_path,
      'category', old.category,
      'task_id', old.task_id,
      'uploaded_by', old.uploaded_by
    )
  );

  return old;
end
$function$;

create or replace function public.trusted_activity_from_task()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
declare
  v_assignee_name text;
begin
  if tg_op = 'INSERT' then
    v_assignee_name := public.project_activity_profile_name(new.assignee_id);

    perform public.append_project_activity_internal(
      new.project_id,
      'task_created',
      format('Создана задача «%s»', new.title),
      case
        when new.assignee_id is null
          then 'Исполнитель пока не назначен.'
        else format(
          'Исполнитель: %s.',
          coalesce(v_assignee_name, 'Участник проекта')
        )
      end,
      'task',
      new.id,
      jsonb_build_object(
        'task_id', new.id,
        'task_title', new.title,
        'assignee_id', new.assignee_id,
        'status', new.status,
        'start_at', new.start_at,
        'due_at', new.due_at
      )
    );

    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.append_project_activity_internal(
      old.project_id,
      'task_deleted',
      format('Удалена задача «%s»', old.title),
      null,
      'task',
      old.id,
      jsonb_build_object(
        'task_id', old.id,
        'task_title', old.title,
        'last_status', old.status,
        'last_assignee_id', old.assignee_id
      )
    );

    return old;
  end if;

  if new.status is distinct from old.status then
    perform public.append_project_activity_internal(
      new.project_id,
      case
        when new.status = 'done' then 'task_completed'
        else 'task_status_changed'
      end,
      case
        when new.status = 'done'
          then format('Задача «%s» завершена', new.title)
        else format('Статус задачи «%s» изменён', new.title)
      end,
      format('Статус: %s → %s.', old.status, new.status),
      'task',
      new.id,
      jsonb_build_object(
        'task_id', new.id,
        'task_title', new.title,
        'old_status', old.status,
        'new_status', new.status,
        'completed_at', new.completed_at
      )
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    v_assignee_name := public.project_activity_profile_name(new.assignee_id);

    perform public.append_project_activity_internal(
      new.project_id,
      'task_assignee_changed',
      format('Изменён исполнитель задачи «%s»', new.title),
      case
        when new.assignee_id is null
          then 'Исполнитель снят.'
        else format(
          'Новый исполнитель: %s.',
          coalesce(v_assignee_name, 'Участник проекта')
        )
      end,
      'task',
      new.id,
      jsonb_build_object(
        'task_id', new.id,
        'task_title', new.title,
        'old_assignee_id', old.assignee_id,
        'new_assignee_id', new.assignee_id
      )
    );
  end if;

  return new;
end
$function$;

create or replace function public.visible_application_count (
  p_listing_id uuid
)
  returns bigint
  language sql
  stable
  security definer
  set search_path to 'public', 'pg_temp'
  AS $function$
  select case
    when public.can_read_listing(p_listing_id) then (
      select count(*)::bigint
      from public.applications a
      where a.listing_id = p_listing_id
    )
    else 0::bigint
  end;
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
    raise exception 'Аукцион уже не открыт.';
  end if;

  update public.auction_bids
  set status = 'withdrawn'
  where id = v_bid.id;

  return query select v_bid.id, false;
end
$function$;

alter table "public"."auction_access_requests"
  add constraint "auction_access_requests_auction_id_fkey" foreign key (auction_id) references public.auctions(id) on delete cascade;

alter table "public"."auction_bids"
  add constraint "auction_bids_auction_id_fkey" foreign key (auction_id) references public.auctions(id) on delete cascade;

alter table "public"."auction_protected"
  add constraint "auction_protected_auction_id_fkey" foreign key (auction_id) references public.auctions(id) on delete cascade;

alter table "public"."listings"
  add constraint "listings_created_by_fkey" foreign key (created_by) references auth.users(id);

alter table "public"."auctions"
  add constraint "auctions_linked_listing_id_fkey" foreign key (linked_listing_id) references public.listings(id) on delete set null;

alter table "public"."contributions"
  add constraint "contributions_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."notifications"
  add constraint "notifications_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."profile_reviews"
  add constraint "profile_reviews_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."project_activity"
  add constraint "project_activity_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."project_documents"
  add constraint "project_documents_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."project_events"
  add constraint "project_events_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."project_file_upload_reservations"
  add constraint "project_file_upload_reservations_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."project_files"
  add constraint "project_files_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."project_message_hidden"
  add constraint "project_message_hidden_message_id_fkey" foreign key (message_id) references public.project_messages(id) on delete cascade;

alter table "public"."project_messages"
  add constraint "project_messages_parent_message_id_fkey" foreign key (parent_message_id) references public.project_messages(id) on delete set null;

alter table "public"."project_messages"
  add constraint "project_messages_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."contributions"
  add constraint "contributions_task_id_fkey" foreign key (task_id) references public.tasks(id) on delete set null;

alter table "public"."project_file_upload_reservations"
  add constraint "project_file_upload_reservations_task_id_fkey" foreign key (task_id) references public.tasks(id) on delete set null;

alter table "public"."project_files"
  add constraint "project_files_task_id_fkey" foreign key (task_id) references public.tasks(id) on delete set null;

alter table "public"."tasks"
  add constraint "tasks_project_id_fkey" foreign key (project_id) references public.listings(id) on delete cascade;

alter table "public"."user_settings"
  add constraint "user_settings_user_id_fkey" foreign key (user_id) references auth.users(id) on delete cascade;

create view "public"."listings_with_count" with (security_invoker=true) AS  SELECT id,
    title,
    description,
    roles_needed,
    skills,
    timezone,
    visibility,
    created_at,
    created_by,
    public.visible_application_count(id) AS applications_count
   FROM public.listings l;

create unique index applications_listing_user_unique on public.applications using btree (listing_id, user_id);

create unique index auction_access_requests_auction_requester_unique on public.auction_access_requests using btree (auction_id, requester_id);

create unique index auction_bids_auction_bidder_unique on public.auction_bids using btree (auction_id, bidder_id);

create unique index auction_bids_one_accepted_per_auction on public.auction_bids using btree (auction_id)
  where (status = 'accepted'::text);

create index idx_auction_access_requests_auction on public.auction_access_requests using btree (auction_id);

create index idx_auction_access_requests_requester on public.auction_access_requests using btree (requester_id);

create index idx_auction_access_requests_status on public.auction_access_requests using btree (status);

create index idx_auction_bids_auction on public.auction_bids using btree (auction_id);

create index idx_auction_bids_bidder on public.auction_bids using btree (bidder_id);

create index idx_auction_bids_status on public.auction_bids using btree (status);

create index idx_auctions_ends_at on public.auctions using btree (ends_at);

create index idx_auctions_linked_listing on public.auctions using btree (linked_listing_id);

create index idx_auctions_owner on public.auctions using btree (owner_id);

create index idx_auctions_type_status on public.auctions using btree (type, status);

create index idx_contributions_project_created on public.contributions using btree (project_id, created_at);

create index idx_listings_deadline_at on public.listings using btree (deadline_at);

create index idx_notifications_project on public.notifications using btree (project_id);

create index idx_notifications_recipient_created on public.notifications using btree (recipient_id, created_at desc);

create index idx_notifications_recipient_unread on public.notifications using btree (recipient_id, read_at)
  where (read_at is null);

create index idx_profile_reviews_project on public.profile_reviews using btree (project_id);

create index idx_profile_reviews_reviewed_user on public.profile_reviews using btree (reviewed_user_id, created_at desc);

create index idx_profile_reviews_reviewer on public.profile_reviews using btree (reviewer_id);

create index idx_profiles_city on public.profiles using btree (city);

create index idx_profiles_experience_level on public.profiles using btree (experience_level);

create index idx_profiles_visibility on public.profiles using btree (visibility);

create index idx_profiles_work_format on public.profiles using btree (work_format);

create index idx_project_activity_actor on public.project_activity using btree (actor_id);

create index idx_project_activity_project_created on public.project_activity using btree (project_id, created_at desc);

create index idx_project_activity_type on public.project_activity using btree (type);

create index idx_project_documents_project_updated on public.project_documents using btree (project_id, updated_at desc);

create index idx_project_events_project_starts on public.project_events using btree (project_id, starts_at);

create index idx_project_file_upload_reservations_project on public.project_file_upload_reservations using btree (project_id);

create index idx_project_file_upload_reservations_user_expiry on public.project_file_upload_reservations using btree (user_id, expires_at);

create index idx_project_files_project_category on public.project_files using btree (project_id, category, created_at desc);

create index idx_project_files_project_created on public.project_files using btree (project_id, created_at);

create index idx_project_message_hidden_user_message on public.project_message_hidden using btree (user_id, message_id);

create index idx_project_messages_project_created on public.project_messages using btree (project_id, created_at);

create index idx_tasks_project_created on public.tasks using btree (project_id, created_at);

create index idx_tasks_project_due on public.tasks using btree (project_id, due_at);

create index idx_tasks_project_start_due on public.tasks using btree (project_id, start_at, due_at);

create unique index project_files_file_path_unique on public.project_files using btree (file_path);

create unique index project_files_upload_reservation_unique on public.project_files using btree (upload_reservation_id)
  where (upload_reservation_id is not null);

create trigger trg_guard_application_update
  before update on public.applications
  for each row
  execute function public.guard_application_update();

create trigger set_auction_access_requests_updated_at
  before update on public.auction_access_requests
  for each row
  execute function public.set_updated_at();

create trigger trg_auction_access_requests_identity
  before update on public.auction_access_requests
  for each row
  execute function public.prevent_identity_columns_update('auction_id', 'requester_id');

create trigger trg_guard_auction_access_request_update
  before update on public.auction_access_requests
  for each row
  execute function public.guard_auction_access_request_update();

create trigger set_auction_bids_updated_at
  before update on public.auction_bids
  for each row
  execute function public.set_updated_at();

create trigger trg_guard_auction_bid_update
  before update on public.auction_bids
  for each row
  execute function public.guard_auction_bid_update();

create trigger set_auction_protected_updated_at
  before update on public.auction_protected
  for each row
  execute function public.set_updated_at();

create trigger set_auctions_updated_at
  before update on public.auctions
  for each row
  execute function public.set_updated_at();

create trigger trg_guard_auction_status_transition
  before update of status on public.auctions
  for each row
  execute function public.guard_auction_status_transition();

create trigger trg_phase8_guard_contributions
  before insert or update on public.contributions
  for each row
  execute function public.phase8_guard_contribution_row();

create trigger trg_trusted_activity_contributions
  after insert or update on public.contributions
  for each row
  execute function public.trusted_activity_from_contribution();

create trigger set_profile_reviews_updated_at
  before update on public.profile_reviews
  for each row
  execute function public.set_updated_at();

create trigger trg_profile_reviews_identity
  before update on public.profile_reviews
  for each row
  execute function public.prevent_identity_columns_update('project_id', 'reviewer_id', 'reviewed_user_id');

create trigger trg_trusted_activity_profile_reviews
  after insert or update on public.profile_reviews
  for each row
  execute function public.trusted_activity_from_profile_review();

create trigger set_project_documents_updated_at
  before update on public.project_documents
  for each row
  execute function public.set_updated_at();

create trigger trg_phase8_guard_project_documents
  before insert or update on public.project_documents
  for each row
  execute function public.phase8_guard_project_document_row();

create trigger trg_guard_project_file_row
  before insert or update on public.project_files
  for each row
  execute function public.guard_project_file_row();

create trigger trg_trusted_activity_project_files
  after insert or delete on public.project_files
  for each row
  execute function public.trusted_activity_from_project_file();

create trigger trg_project_message_hidden_identity
  before update on public.project_message_hidden
  for each row
  execute function public.prevent_identity_columns_update('message_id', 'user_id');

create trigger trg_phase8_guard_project_messages
  before insert or update on public.project_messages
  for each row
  execute function public.phase8_guard_project_message_row();

create trigger trg_phase8_guard_tasks
  before insert or update on public.tasks
  for each row
  execute function public.phase8_guard_task_row();

create trigger trg_trusted_activity_tasks
  after insert or delete or update on public.tasks
  for each row
  execute function public.trusted_activity_from_task();

create trigger set_user_settings_updated_at
  before update on public.user_settings
  for each row
  execute function public.set_updated_at();

create policy "Applicant or listing owner can update application" on "public"."applications"
  for update
  to "authenticated"
  using (((user_id = auth.uid()) or public.is_listing_owner(listing_id)))
  with check (((user_id = auth.uid()) OR public.is_listing_owner(listing_id)));

create policy "Applications visible to applicant or listing owner" on "public"."applications"
  for select
  to "authenticated"
  using (((user_id = auth.uid()) or public.is_listing_owner(listing_id)));

create policy "Listing owners can create pending invitations" on "public"."applications"
  for insert
  to "authenticated"
  with check ((public.is_listing_owner(listing_id) AND (user_id <> auth.uid()) AND (COALESCE(invited_by_author, false) = true) AND (status = 'pending'::text)));

create policy "Users can create own pending applications" on "public"."applications"
  for insert
  to "authenticated"
  with check (((user_id = auth.uid()) AND (NOT public.is_listing_owner(listing_id)) AND (COALESCE(invited_by_author, false) = false) AND (status = 'pending'::text)));

create policy "Auction owners can review access requests" on "public"."auction_access_requests"
  for update
  to "authenticated"
  using ((exists ( select 1
   from public.auctions a
  where ((a.id = auction_access_requests.auction_id) AND (a.owner_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM public.auctions a
  WHERE ((a.id = auction_access_requests.auction_id) AND (a.owner_id = auth.uid())))));

create policy "Authenticated users can request protected access" on "public"."auction_access_requests"
  for insert
  to "authenticated"
  with check (((requester_id = auth.uid()) AND (status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM public.auctions a
  WHERE ((a.id = auction_access_requests.auction_id) AND (a.type = 'offer'::text) AND (a.owner_id <> auth.uid()) AND (a.status = ANY (ARRAY['open'::text, 'closed'::text])))))));

create policy "Owners and requesters can read access requests" on "public"."auction_access_requests"
  for select
  to "authenticated"
  using (((requester_id = auth.uid()) or (exists ( select 1
   from public.auctions a
  where ((a.id = auction_access_requests.auction_id) AND (a.owner_id = auth.uid()))))));

create policy "Auction owners can update bid statuses" on "public"."auction_bids"
  for update
  to "authenticated"
  using ((exists ( select 1
   from public.auctions a
  where ((a.id = auction_bids.auction_id) AND (a.owner_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM public.auctions a
  WHERE ((a.id = auction_bids.auction_id) AND (a.owner_id = auth.uid())))));

create policy "Authenticated users can create bids" on "public"."auction_bids"
  for insert
  to "authenticated"
  with check (((bidder_id = auth.uid()) AND (status = 'new'::text) AND (EXISTS ( SELECT 1
   FROM public.auctions a
  WHERE ((a.id = auction_bids.auction_id) AND (a.status = 'open'::text) AND (a.owner_id <> auth.uid()) AND ((a.ends_at IS NULL) OR (a.ends_at > now())))))));

create policy "Bidders can update own non-final bids" on "public"."auction_bids"
  for update
  to "authenticated"
  using (((bidder_id = auth.uid()) AND (status = ANY (ARRAY['new'::text, 'withdrawn'::text]))))
  with check (((bidder_id = auth.uid()) AND (status = ANY (ARRAY['new'::text, 'withdrawn'::text]))));

create policy "Owners and bidders can read bids" on "public"."auction_bids"
  for select
  to "authenticated"
  using (((bidder_id = auth.uid()) or (exists ( select 1
   from public.auctions a
  where ((a.id = auction_bids.auction_id) AND (a.owner_id = auth.uid()))))));

create policy "Owners and approved users can read protected auction data" on "public"."auction_protected"
  for select
  to "authenticated"
  using (((exists ( select 1
   from public.auctions a
  where ((a.id = auction_protected.auction_id) AND (a.owner_id = auth.uid())))) or (exists ( select 1
   from public.auction_access_requests r
  where ((r.auction_id = auction_protected.auction_id) AND (r.requester_id = auth.uid()) AND (r.status = 'approved'::text))))));

create policy "Owners can delete protected auction data" on "public"."auction_protected"
  for delete
  to "authenticated"
  using ((exists ( select 1
   from public.auctions a
  where ((a.id = auction_protected.auction_id) AND (a.owner_id = auth.uid())))));

create policy "Owners can insert protected auction data" on "public"."auction_protected"
  for insert
  to "authenticated"
  with check ((EXISTS ( SELECT 1
   FROM public.auctions a
  WHERE ((a.id = auction_protected.auction_id) AND (a.owner_id = auth.uid()) AND (a.type = 'offer'::text)))));

create policy "Owners can update protected auction data" on "public"."auction_protected"
  for update
  to "authenticated"
  using ((exists ( select 1
   from public.auctions a
  where ((a.id = auction_protected.auction_id) AND (a.owner_id = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM public.auctions a
  WHERE ((a.id = auction_protected.auction_id) AND (a.owner_id = auth.uid())))));

create policy "Owners can create auctions" on "public"."auctions"
  for insert
  to "authenticated"
  with check ((owner_id = auth.uid()));

create policy "Owners can delete draft auctions without bids" on "public"."auctions"
  for delete
  to "authenticated"
  using (((owner_id = auth.uid()) AND (status = 'draft'::text) AND (not (exists ( select 1
   from public.auction_bids b
  where (b.auction_id = auctions.id))))));

create policy "Owners can update own auctions" on "public"."auctions"
  for update
  to "authenticated"
  using ((owner_id = auth.uid()))
  with check ((owner_id = auth.uid()));

create policy "Public can read open and closed auctions" on "public"."auctions"
  for select
  to PUBLIC
  using (((status = ANY (ARRAY['open'::text, 'closed'::text])) or (owner_id = auth.uid())));

create policy "Active members can delete own unverified contributions" on "public"."contributions"
  for delete
  to "authenticated"
  using (((user_id = auth.uid()) AND (verified_by is null) AND public.phase8_current_user_is_project_member(project_id)));

create policy "Active members can update own unverified contributions" on "public"."contributions"
  for update
  to "authenticated"
  using (((user_id = auth.uid()) AND (verified_by is null) AND public.phase8_current_user_is_project_member(project_id)))
  with check (((user_id = auth.uid()) AND (verified_by IS NULL) AND public.phase8_current_user_is_project_member(project_id)));

create policy "Project authors can verify contributions" on "public"."contributions"
  for update
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = contributions.project_id) AND (listings.created_by = auth.uid())))))
  with check ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = contributions.project_id) AND (listings.created_by = auth.uid())))));

create policy "Project members can insert own contributions" on "public"."contributions"
  for insert
  to "authenticated"
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = contributions.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = contributions.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text))))))))));

create policy "Project members can read contributions" on "public"."contributions"
  for select
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = contributions.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = contributions.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Authenticated users create own listings" on "public"."listings"
  for insert
  to "authenticated"
  with check ((created_by = auth.uid()));

create policy "Owners delete own listings" on "public"."listings"
  for delete
  to "authenticated"
  using ((created_by = auth.uid()));

create policy "Owners update own listings" on "public"."listings"
  for update
  to "authenticated"
  using ((created_by = auth.uid()))
  with check ((created_by = auth.uid()));

create policy "Visible listings can be read" on "public"."listings"
  for select
  to PUBLIC
  using (public.can_read_listing(id));

create policy "Users can read own notifications" on "public"."notifications"
  for select
  to "authenticated"
  using ((recipient_id = auth.uid()));

create policy "Users can update own notifications" on "public"."notifications"
  for update
  to "authenticated"
  using ((recipient_id = auth.uid()))
  with check ((recipient_id = auth.uid()));

create policy "Anyone can read profile reviews" on "public"."profile_reviews"
  for select
  to PUBLIC
  using (true);

create policy "Project participants can create reviews" on "public"."profile_reviews"
  for insert
  to "authenticated"
  with check (((reviewer_id = auth.uid()) AND (reviewer_id <> reviewed_user_id) AND ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = profile_reviews.project_id) AND (l.created_by = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.applications a
  WHERE ((a.listing_id = profile_reviews.project_id) AND (a.user_id = auth.uid()) AND (a.status = 'accepted'::text))))) AND ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = profile_reviews.project_id) AND (l.created_by = profile_reviews.reviewed_user_id)))) OR (EXISTS ( SELECT 1
   FROM public.applications a
  WHERE ((a.listing_id = profile_reviews.project_id) AND (a.user_id = profile_reviews.reviewed_user_id) AND (a.status = 'accepted'::text)))))));

create policy "Reviewers can delete own reviews" on "public"."profile_reviews"
  for delete
  to "authenticated"
  using ((reviewer_id = auth.uid()));

create policy "Reviewers can update own reviews" on "public"."profile_reviews"
  for update
  to "authenticated"
  using ((reviewer_id = auth.uid()))
  with check (((reviewer_id = auth.uid()) AND (reviewer_id <> reviewed_user_id)));

create policy "Project members can read activity" on "public"."project_activity"
  for select
  to "authenticated"
  using (((exists ( select 1
   from public.listings l
  where ((l.id = project_activity.project_id) AND (l.created_by = auth.uid())))) or (exists ( select 1
   from public.applications a
  where ((a.listing_id = project_activity.project_id) AND (a.user_id = auth.uid()) AND (a.status = 'accepted'::text))))));

create policy "Active authors and project owners can delete documents" on "public"."project_documents"
  for delete
  to "authenticated"
  using ((public.phase8_current_user_is_project_owner(project_id) or ((author_id = auth.uid()) AND public.phase8_current_user_is_project_member(project_id))));

create policy "Active authors and project owners can update documents" on "public"."project_documents"
  for update
  to "authenticated"
  using ((public.phase8_current_user_is_project_owner(project_id) or ((author_id = auth.uid()) AND public.phase8_current_user_is_project_member(project_id))))
  with check ((public.phase8_current_user_is_project_owner(project_id) OR ((author_id = auth.uid()) AND public.phase8_current_user_is_project_member(project_id))));

create policy "Project members can create project documents" on "public"."project_documents"
  for insert
  to "authenticated"
  with check (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = project_documents.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = project_documents.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text))))))))));

create policy "Project members can read project documents" on "public"."project_documents"
  for select
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = project_documents.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = project_documents.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Event authors and project owners can delete events" on "public"."project_events"
  for delete
  to "authenticated"
  using (((created_by = auth.uid()) or (exists ( select 1
   from public.listings
  where ((listings.id = project_events.project_id) AND (listings.created_by = auth.uid()))))));

create policy "Event authors and project owners can update events" on "public"."project_events"
  for update
  to "authenticated"
  using (((created_by = auth.uid()) or (exists ( select 1
   from public.listings
  where ((listings.id = project_events.project_id) AND (listings.created_by = auth.uid()))))))
  with check (((created_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = project_events.project_id) AND (listings.created_by = auth.uid()))))));

create policy "Project members can create project events" on "public"."project_events"
  for insert
  to "authenticated"
  with check (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = project_events.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = project_events.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text))))))))));

create policy "Project members can read project events" on "public"."project_events"
  for select
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = project_events.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = project_events.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Project members can read project files" on "public"."project_files"
  for select
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = project_files.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = project_files.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Users can hide accessible project messages" on "public"."project_message_hidden"
  for insert
  to "authenticated"
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.project_messages m
  WHERE ((m.id = project_message_hidden.message_id) AND public.phase8_current_user_is_project_member(m.project_id))))));

create policy "Users can read their hidden project messages" on "public"."project_message_hidden"
  for select
  to "authenticated"
  using ((user_id = auth.uid()));

create policy "Users can unhide own project messages" on "public"."project_message_hidden"
  for delete
  to "authenticated"
  using ((user_id = auth.uid()));

create policy "Users can update own accessible hidden message records" on "public"."project_message_hidden"
  for update
  to "authenticated"
  using ((user_id = auth.uid()))
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.project_messages m
  WHERE ((m.id = project_message_hidden.message_id) AND public.phase8_current_user_is_project_member(m.project_id))))));

create policy "Message authors can update their own messages" on "public"."project_messages"
  for update
  to "authenticated"
  using (((author_id = auth.uid()) AND (exists ( select 1
   from public.listings
  where ((listings.id = project_messages.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = project_messages.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text))))))))))
  with check (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = project_messages.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = project_messages.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text))))))))));

create policy "Project members can insert project messages" on "public"."project_messages"
  for insert
  to "authenticated"
  with check (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = project_messages.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = project_messages.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text))))))))));

create policy "Project members can read project messages" on "public"."project_messages"
  for select
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = project_messages.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = project_messages.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Project members can delete tasks" on "public"."tasks"
  for delete
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = tasks.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = tasks.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Project members can insert tasks" on "public"."tasks"
  for insert
  to "authenticated"
  with check ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = tasks.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = tasks.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Project members can read tasks" on "public"."tasks"
  for select
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = tasks.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = tasks.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Project members can update tasks" on "public"."tasks"
  for update
  to "authenticated"
  using ((exists ( select 1
   from public.listings
  where ((listings.id = tasks.project_id) AND ((listings.created_by = auth.uid()) or (exists ( select 1
           from public.applications
          where ((applications.listing_id = tasks.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))))
  with check ((EXISTS ( SELECT 1
   FROM public.listings
  WHERE ((listings.id = tasks.project_id) AND ((listings.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM public.applications
          WHERE ((applications.listing_id = tasks.project_id) AND (applications.user_id = auth.uid()) AND (applications.status = 'accepted'::text)))))))));

create policy "Users can insert own settings" on "public"."user_settings"
  for insert
  to "authenticated"
  with check ((user_id = auth.uid()));

create policy "Users can read own settings" on "public"."user_settings"
  for select
  to "authenticated"
  using ((user_id = auth.uid()));

create policy "Users can update own settings" on "public"."user_settings"
  for update
  to "authenticated"
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));

alter publication "supabase_realtime" add table "public"."notifications";

revoke all on function "public"."accept_auction_bid_secure"(uuid, uuid) from public;

grant execute on function "public"."accept_auction_bid_secure"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."append_project_activity_internal"(uuid, text, text, text, text, uuid, jsonb) from public;

grant execute on function "public"."append_project_activity_internal"(uuid, text, text, text, text, uuid, jsonb) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."can_delete_project_file_object"(text, text) from public;

grant execute on function "public"."can_delete_project_file_object"(text, text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."can_read_listing"(uuid) from public;

grant execute on function "public"."can_read_listing"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."can_read_project_file_object"(text, text) from public;

grant execute on function "public"."can_read_project_file_object"(text, text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."can_view_profile_identity"(uuid) from public;

grant execute on function "public"."can_view_profile_identity"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."cancel_project_file_upload_secure"(uuid, uuid) from public;

grant execute on function "public"."cancel_project_file_upload_secure"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."create_notification_secure"(uuid, uuid, uuid, text, text, text, text, jsonb) from public;

grant execute on function "public"."create_notification_secure"(uuid, uuid, uuid, text, text, text, text, jsonb) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."decide_auction_access_secure"(uuid, uuid, text) from public;

grant execute on function "public"."decide_auction_access_secure"(uuid, uuid, text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."delete_project_file_record_secure"(uuid, uuid) from public;

grant execute on function "public"."delete_project_file_record_secure"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."finalize_project_file_upload_secure"(uuid, uuid) from public;

grant execute on function "public"."finalize_project_file_upload_secure"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."guard_application_update"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."guard_auction_access_request_update"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."guard_auction_bid_update"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."guard_auction_status_transition"() to public, "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."guard_project_file_row"() to public, "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."has_listing_relation"(uuid) from public;

grant execute on function "public"."has_listing_relation"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."has_valid_project_file_upload_reservation"(text) from public;

grant execute on function "public"."has_valid_project_file_upload_reservation"(text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."insert_auction_decision_notification_internal"(uuid, uuid, uuid, text, text, text, text, jsonb) from public;

grant execute
  on function "public"."insert_auction_decision_notification_internal"(uuid, uuid, uuid, text, text, text, text, jsonb)
  to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."is_listing_owner"(uuid) from public;

grant execute on function "public"."is_listing_owner"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."is_project_member"(uuid, uuid) from public;

grant execute on function "public"."is_project_member"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_current_user_is_project_member"(uuid) from public;

grant execute on function "public"."phase8_current_user_is_project_member"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_current_user_is_project_owner"(uuid) from public;

grant execute on function "public"."phase8_current_user_is_project_owner"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_guard_contribution_row"() from public;

grant execute on function "public"."phase8_guard_contribution_row"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_guard_project_document_row"() from public;

grant execute on function "public"."phase8_guard_project_document_row"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_guard_project_message_row"() from public;

grant execute on function "public"."phase8_guard_project_message_row"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_guard_task_row"() from public;

grant execute on function "public"."phase8_guard_task_row"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_is_project_member_internal"(uuid, uuid) from public;

grant execute on function "public"."phase8_is_project_member_internal"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."phase8_is_project_owner_internal"(uuid, uuid) from public;

grant execute on function "public"."phase8_is_project_owner_internal"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."prevent_identity_columns_update"() to public, "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."project_activity_profile_name"(uuid) from public;

grant execute on function "public"."project_activity_profile_name"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."project_file_is_member"(uuid, uuid) from public;

grant execute on function "public"."project_file_is_member"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."project_file_is_owner"(uuid, uuid) from public;

grant execute on function "public"."project_file_is_owner"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."project_file_project_id_from_path"(text) from public;

grant execute on function "public"."project_file_project_id_from_path"(text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."request_auction_access_secure"(uuid, uuid, text) from public;

grant execute on function "public"."request_auction_access_secure"(uuid, uuid, text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."reserve_project_file_upload_secure"(uuid, uuid, text, bigint, text, text, text, text, uuid) from public;

grant execute
  on function "public"."reserve_project_file_upload_secure"(uuid, uuid, text, bigint, text, text, text, text, uuid)
  to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."review_auction_bid_secure"(uuid, uuid, text) from public;

grant execute on function "public"."review_auction_bid_secure"(uuid, uuid, text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."save_auction_bid_secure"(uuid, uuid, numeric, text, timestamp with time zone, text, text, text) from public;

grant execute
  on function "public"."save_auction_bid_secure"(uuid, uuid, numeric, text, timestamp with time zone, text, text, text)
  to "anon", "authenticated", "postgres", "service_role";

grant execute on function "public"."set_updated_at"() to public, "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."transition_auction_status_secure"(uuid, uuid, text) from public;

grant execute on function "public"."transition_auction_status_secure"(uuid, uuid, text) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."trusted_activity_from_contribution"() from public;

grant execute on function "public"."trusted_activity_from_contribution"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."trusted_activity_from_profile_review"() from public;

grant execute on function "public"."trusted_activity_from_profile_review"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."trusted_activity_from_project_file"() from public;

grant execute on function "public"."trusted_activity_from_project_file"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."trusted_activity_from_task"() from public;

grant execute on function "public"."trusted_activity_from_task"() to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."visible_application_count"(uuid) from public;

grant execute on function "public"."visible_application_count"(uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on function "public"."withdraw_auction_bid_secure"(uuid, uuid) from public;

grant execute on function "public"."withdraw_auction_bid_secure"(uuid, uuid) to "anon", "authenticated", "postgres", "service_role";

revoke all on table "public"."applications" from "anon";

grant delete, insert, maintain, select, update on table "public"."applications" to "anon";

revoke all on table "public"."applications" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."applications" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."applications" to "postgres", "service_role";

revoke all on table "public"."auction_access_requests" from "anon";

grant delete, maintain, select on table "public"."auction_access_requests" to "anon";

revoke all on table "public"."auction_access_requests" from "authenticated";

grant delete, maintain, select on table "public"."auction_access_requests" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."auction_access_requests" to "postgres", "service_role";

revoke all on table "public"."auction_bids" from "anon";

grant delete, maintain, select on table "public"."auction_bids" to "anon";

revoke all on table "public"."auction_bids" from "authenticated";

grant delete, maintain, select on table "public"."auction_bids" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."auction_bids" to "postgres", "service_role";

revoke all on table "public"."auction_protected" from "anon";

grant delete, insert, maintain, select, update on table "public"."auction_protected" to "anon";

revoke all on table "public"."auction_protected" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."auction_protected" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."auction_protected" to "postgres", "service_role";

revoke all on table "public"."auctions" from "anon";

grant delete, insert, maintain, select, update on table "public"."auctions" to "anon";

revoke all on table "public"."auctions" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."auctions" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."auctions" to "postgres", "service_role";

revoke all on table "public"."contributions" from "anon";

grant delete, insert, maintain, select, update on table "public"."contributions" to "anon";

revoke all on table "public"."contributions" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."contributions" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."contributions" to "postgres", "service_role";

revoke all on table "public"."listings" from "anon";

grant delete, insert, maintain, select, update on table "public"."listings" to "anon";

revoke all on table "public"."listings" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."listings" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."listings" to "postgres", "service_role";

revoke all on table "public"."notifications" from "anon";

grant delete, maintain, select, update on table "public"."notifications" to "anon";

revoke all on table "public"."notifications" from "authenticated";

grant delete, maintain, select, update on table "public"."notifications" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."notifications" to "postgres", "service_role";

revoke all on table "public"."profile_reviews" from "anon";

grant delete, insert, maintain, select, update on table "public"."profile_reviews" to "anon";

revoke all on table "public"."profile_reviews" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."profile_reviews" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."profile_reviews" to "postgres", "service_role";

revoke all on table "public"."profiles" from "authenticated";

grant insert, maintain, select, update on table "public"."profiles" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."profiles" to "postgres", "service_role";

revoke all on table "public"."project_activity" from "anon";

grant maintain, select on table "public"."project_activity" to "anon";

revoke all on table "public"."project_activity" from "authenticated";

grant maintain, select on table "public"."project_activity" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_activity" to "postgres", "service_role";

revoke all on table "public"."project_documents" from "anon";

grant delete, insert, maintain, select, update on table "public"."project_documents" to "anon";

revoke all on table "public"."project_documents" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."project_documents" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_documents" to "postgres", "service_role";

revoke all on table "public"."project_events" from "anon";

grant delete, insert, maintain, select, update on table "public"."project_events" to "anon";

revoke all on table "public"."project_events" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."project_events" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_events" to "postgres", "service_role";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_file_upload_reservations" to "postgres", "service_role";

revoke all on table "public"."project_files" from "anon";

grant maintain, select, update on table "public"."project_files" to "anon";

revoke all on table "public"."project_files" from "authenticated";

grant maintain, select, update on table "public"."project_files" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_files" to "postgres", "service_role";

revoke all on table "public"."project_message_hidden" from "anon";

grant delete, insert, maintain, select, update on table "public"."project_message_hidden" to "anon";

revoke all on table "public"."project_message_hidden" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."project_message_hidden" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_message_hidden" to "postgres", "service_role";

revoke all on table "public"."project_messages" from "anon";

grant delete, insert, maintain, select, update on table "public"."project_messages" to "anon";

revoke all on table "public"."project_messages" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."project_messages" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."project_messages" to "postgres", "service_role";

revoke all on table "public"."tasks" from "anon";

grant delete, insert, maintain, select, update on table "public"."tasks" to "anon";

revoke all on table "public"."tasks" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."tasks" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."tasks" to "postgres", "service_role";

revoke all on table "public"."user_settings" from "anon";

grant delete, insert, maintain, select, update on table "public"."user_settings" to "anon";

revoke all on table "public"."user_settings" from "authenticated";

grant delete, insert, maintain, select, update on table "public"."user_settings" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."user_settings" to "postgres", "service_role";

revoke all on table "public"."listings_with_count" from "anon";

grant select on table "public"."listings_with_count" to "anon";

revoke all on table "public"."listings_with_count" from "authenticated";

grant select on table "public"."listings_with_count" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."listings_with_count" to "postgres", "service_role";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "anon";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "authenticated";

alter default privileges for role "postgres" in schema "public" grant select, update, usage on sequences to "service_role";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "anon";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "authenticated";

alter default privileges for role "postgres" in schema "public" grant execute on FUNCTIONS to "service_role";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "anon";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "authenticated";

alter default privileges for role "postgres" in schema "public" grant delete, insert, maintain, references, select, trigger, truncate, update on tables to "service_role";

alter table "public"."auction_access_requests"
  add constraint "auction_access_requests_requester_id_fkey" foreign key (requester_id) references public.profiles(user_id) on delete cascade;

alter table "public"."auction_access_requests"
  add constraint "auction_access_requests_reviewed_by_fkey" foreign key (reviewed_by) references public.profiles(user_id) on delete set null;

alter table "public"."auction_bids"
  add constraint "auction_bids_bidder_id_fkey" foreign key (bidder_id) references public.profiles(user_id) on delete cascade;

alter table "public"."auctions"
  add constraint "auctions_owner_id_fkey" foreign key (owner_id) references public.profiles(user_id) on delete cascade;

alter table "public"."contributions"
  add constraint "contributions_user_id_fkey" foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table "public"."contributions"
  add constraint "contributions_verified_by_fkey" foreign key (verified_by) references public.profiles(user_id) on delete set null;

alter table "public"."notifications"
  add constraint "notifications_actor_id_fkey" foreign key (actor_id) references public.profiles(user_id) on delete set null;

alter table "public"."notifications"
  add constraint "notifications_recipient_id_fkey" foreign key (recipient_id) references public.profiles(user_id) on delete cascade;

alter table "public"."profile_reviews"
  add constraint "profile_reviews_reviewed_user_id_fkey" foreign key (reviewed_user_id) references public.profiles(user_id) on delete cascade;

alter table "public"."profile_reviews"
  add constraint "profile_reviews_reviewer_id_fkey" foreign key (reviewer_id) references public.profiles(user_id) on delete cascade;

alter table "public"."project_activity"
  add constraint "project_activity_actor_id_fkey" foreign key (actor_id) references public.profiles(user_id) on delete set null;

alter table "public"."project_documents"
  add constraint "project_documents_author_id_fkey" foreign key (author_id) references public.profiles(user_id) on delete cascade;

alter table "public"."project_events"
  add constraint "project_events_created_by_fkey" foreign key (created_by) references public.profiles(user_id) on delete cascade;

alter table "public"."project_file_upload_reservations"
  add constraint "project_file_upload_reservations_user_id_fkey" foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table "public"."project_files"
  add constraint "project_files_uploaded_by_fkey" foreign key (uploaded_by) references public.profiles(user_id) on delete cascade;

alter table "public"."project_message_hidden"
  add constraint "project_message_hidden_user_id_fkey" foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table "public"."project_messages"
  add constraint "project_messages_author_id_fkey" foreign key (author_id) references public.profiles(user_id) on delete cascade;

alter table "public"."tasks"
  add constraint "tasks_assignee_id_fkey" foreign key (assignee_id) references public.profiles(user_id) on delete set null;

alter table "public"."tasks"
  add constraint "tasks_excuse_decided_by_fkey" foreign key (excuse_decided_by) references public.profiles(user_id) on delete set null;

create view "public"."profiles_collaboration" with (security_barrier=true, security_invoker=false) AS  SELECT user_id,
    display_name
   FROM public.profiles p
  WHERE public.can_view_profile_identity(user_id);

create view "public"."profiles_public" with (security_barrier=true, security_invoker=false) AS  SELECT user_id,
    display_name,
    roles,
    skills,
    timezone,
    work_format,
    experience_level,
    about,
        CASE
            WHEN show_city THEN city
            ELSE NULL::text
        END AS city,
        CASE
            WHEN show_rate THEN hourly_rate
            ELSE NULL::numeric
        END AS hourly_rate,
        CASE
            WHEN show_portfolio THEN portfolio_links
            ELSE '[]'::jsonb
        END AS portfolio_links,
        CASE
            WHEN show_availability THEN availability_hours
            ELSE NULL::integer
        END AS availability_hours,
    visibility,
    show_rate,
    show_city,
    show_portfolio,
    show_availability,
    created_at
   FROM public.profiles p
  WHERE ((visibility = 'public'::text) OR ((visibility = 'platform_only'::text) AND (auth.uid() IS NOT NULL)));

create policy "Enable insert for users" on "public"."profiles"
  for insert
  to "authenticated"
  with check ((auth.uid() = user_id));

create policy "Users can read their own profile" on "public"."profiles"
  for select
  to "authenticated"
  using ((user_id = auth.uid()));

create policy "Users can update their own profile" on "public"."profiles"
  for update
  to "authenticated"
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

comment on view "public"."profiles_collaboration" is 'Минимальная идентичность пользователей для проектов, файлов, активности и отзывов: user_id и display_name.';

comment on view "public"."profiles_public" is 'Маскированные данные каталога и публичного профиля. Выполняется с правами владельца, содержит только явно разрешённые поля.';

revoke all on table "public"."profiles_collaboration" from "anon";

grant select on table "public"."profiles_collaboration" to "anon";

revoke all on table "public"."profiles_collaboration" from "authenticated";

grant select on table "public"."profiles_collaboration" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."profiles_collaboration" to "postgres", "service_role";

revoke all on table "public"."profiles_public" from "anon";

grant select on table "public"."profiles_public" to "anon";

revoke all on table "public"."profiles_public" from "authenticated";

grant select on table "public"."profiles_public" to "authenticated";

grant delete, insert, maintain, references, select, trigger, truncate, update on table "public"."profiles_public" to "postgres", "service_role";


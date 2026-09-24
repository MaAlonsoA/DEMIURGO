-- Revisión de S1: integridad por proyecto y versiones cerradas (I4, I9). La base lo impone
-- aunque falle una guarda: una versión es del proyecto de su registro, un criterio del de su
-- versión y un enlace del de sus extremos; y los criterios y enlaces de una versión solo se
-- añaden mientras está en borrador (después su contenido no cambia).

create function version_del_proyecto() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from records r where r.id = new.record_id and r.project_id = new.project_id) then
    raise exception 'La versión y su registro son de proyectos distintos' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger record_versions_del_proyecto before insert on record_versions
  for each row execute function version_del_proyecto();

create function criterio_en_borrador() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from record_versions v
    where v.id = new.record_version_id and v.project_id = new.project_id and v.state = 'draft'
  ) then
    raise exception 'Solo se añaden criterios a una versión en borrador del mismo proyecto' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger criteria_en_borrador before insert on criteria
  for each row execute function criterio_en_borrador();

create function enlace_en_borrador() returns trigger language plpgsql as $$
begin
  if new.from_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.from_id and v.project_id = new.project_id and v.state = 'draft'
  ) then
    raise exception 'Los enlaces de una versión se crean con ella, en borrador y en el mismo proyecto' using errcode = 'P0001';
  end if;
  if new.to_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.to_id and v.project_id = new.project_id
  ) then
    raise exception 'El destino del enlace es de otro proyecto' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger links_en_borrador before insert on links
  for each row execute function enlace_en_borrador();

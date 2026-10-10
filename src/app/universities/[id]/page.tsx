import { UniversityDirectory } from '@/components/UniversityDirectory'
export default async function UniversityPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <UniversityDirectory universityId={id} />
}

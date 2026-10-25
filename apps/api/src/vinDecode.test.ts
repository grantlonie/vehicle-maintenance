import { describe, expect, test } from 'bun:test'
import { decodeVin, describeVinDecode } from './vinDecode'

const vpicFixture = {
  Results: [
    {
      BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)',
      DisplacementL: '2.487',
      DriveType: 'AWD/All-Wheel Drive',
      EngineCylinders: '4',
      EngineModel: 'A25A-FKS',
      FuelTypePrimary: 'Gasoline',
      Make: 'TOYOTA',
      Model: 'RAV4',
      ModelYear: '2021',
      TransmissionStyle: 'Automatic',
      Trim: 'XLE',
    },
  ],
}

function mockFetch(body: unknown, status = 200) {
  const calls: string[] = []
  const fetchImpl = async (input: string) => {
    calls.push(input)
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetchImpl }
}

describe('decodeVin', () => {
  test('parses vPIC results and passes the model year', async () => {
    const { calls, fetchImpl } = mockFetch(vpicFixture)
    const decoded = await decodeVin('2t3p1rfv0mw123456', { fetchImpl, modelYear: 2021 })
    expect(calls[0]).toContain('/DecodeVinValues/2T3P1RFV0MW123456?')
    expect(calls[0]).toContain('modelyear=2021')
    expect(decoded).toMatchObject({
      displacementL: '2.5',
      driveType: 'AWD/All-Wheel Drive',
      make: 'TOYOTA',
      trim: 'XLE',
      year: 2021,
    })
    expect(describeVinDecode(decoded!)).toContain('Engine: 2.5L 4-cyl A25A-FKS')
  })

  test('rejects malformed VINs without calling the API', async () => {
    const { calls, fetchImpl } = mockFetch(vpicFixture)
    expect(await decodeVin('ABC123', { fetchImpl })).toBeNull()
    expect(await decodeVin('2T3P1RFV0MW12345O', { fetchImpl })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test('returns null on HTTP errors or empty results', async () => {
    expect(await decodeVin('2T3P1RFV0MW123456', mockFetch({}, 500))).toBeNull()
    expect(
      await decodeVin('2T3P1RFV0MW123456', mockFetch({ Results: [{ Make: '', Model: '' }] }))
    ).toBeNull()
  })
})

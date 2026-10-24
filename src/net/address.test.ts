import { describe, expect, it } from 'vitest';
import { classifyAddress } from './address';

describe('classifyAddress', () => {
  it.each([
    ['93.184.216.34', 4],
    ['8.8.8.8', 4],
    ['1.1.1.1', 4],
    ['100.63.255.255', 4],
    ['100.128.0.0', 4],
    ['168.63.129.15', 4],
    ['168.63.129.17', 4],
    ['172.15.255.255', 4],
    ['172.32.0.0', 4],
    ['198.17.255.255', 4],
    ['223.255.255.255', 4],
    ['2606:4700:4700::1111', 6],
    ['2a00:1450:4001:80b::200e', 6],
    ['[2606:4700:4700::1111]', 6],
  ] as const)('allows the public address %s', (address, family) => {
    expect(classifyAddress(address)).toEqual({ allowed: true, family });
  });

  it.each([
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['10.0.0.1', 'private'],
    ['168.63.129.16', 'cloud_metadata'],
    ['100.100.100.200', 'shared'],
    ['192.0.0.192', 'reserved'],
    ['10.255.255.255', 'private'],
    ['100.64.0.1', 'shared'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'link_local'],
    ['169.254.0.1', 'link_local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.1', 'reserved'],
    ['192.0.2.1', 'documentation'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'reserved'],
    ['198.19.255.255', 'reserved'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ] as const)('refuses the IPv4 address %s (%s)', (address, reason) => {
    expect(classifyAddress(address)).toEqual({ allowed: false, reason });
  });

  it.each([
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['[::1]', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback'],
    ['::ffff:127.0.0.1', 'ipv4_embedded'],
    ['::ffff:7f00:1', 'ipv4_embedded'],
    ['::ffff:10.0.0.1', 'ipv4_embedded'],
    ['::ffff:169.254.169.254', 'ipv4_embedded'],
    // Even a mapped public address is refused: the guard has no reason to accept the form.
    ['::ffff:8.8.8.8', 'ipv4_embedded'],
    ['::127.0.0.1', 'ipv4_embedded'],
    ['64:ff9b::a00:1', 'ipv4_embedded'],
    ['2002:7f00:1::', 'ipv4_embedded'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'ipv4_embedded'],
    ['fe80::1', 'link_local'],
    ['fe80::1%eth0', 'link_local'],
    ['febf::1', 'link_local'],
    ['fc00::1', 'private'],
    ['fd00:ec2::254', 'private'],
    ['::ffff:168.63.129.16', 'ipv4_embedded'],
    ['fd12:3456:789a::1', 'private'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'documentation'],
    ['3fff::1', 'documentation'],
    ['2001:10::1', 'reserved'],
    ['100::1', 'not_global'],
    ['fec0::1', 'not_global'],
    ['4000::1', 'not_global'],
  ] as const)('refuses the IPv6 address %s (%s)', (address, reason) => {
    expect(classifyAddress(address)).toEqual({ allowed: false, reason });
  });

  it.each([
    'localhost',
    '2130706433',
    '0177.0.0.1',
    '0x7f.0.0.1',
    '127.1',
    '010.0.0.1',
    '1.2.3.4.5',
    '256.0.0.1',
    '',
    '::g',
    '1:2:3:4:5:6:7:8:9',
  ])('refuses %j, which is not a canonical IP address (fails closed)', (address) => {
    expect(classifyAddress(address)).toEqual({ allowed: false, reason: 'invalid' });
  });
});

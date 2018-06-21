/**
 *  @license
 *    Copyright 2018 Brigham Young University
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 **/
'use strict';
const expect        = require('chai').expect;
const Enforcer      = require('../index');

describe('request', () => {

    describe('v2 request parsing', () => {
        let enforcer;

        before(() => {
            enforcer = new Enforcer({
                swagger: '2.0',
                paths: {
                    '/hello': {
                        get: {
                        },
                        post: {
                            parameters: [
                                {
                                    name: 'body',
                                    in: 'body',
                                    schema: { type: 'string' }
                                }
                            ]
                        },
                        put: {
                            parameters: [
                                {
                                    name: 'body',
                                    in: 'body',
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            x: {type: 'number'}
                                        }
                                    }
                                }
                            ]
                        },
                        parameters: [
                            { name: 'name', type: 'string', in: 'query' },
                            { name: 'a', type: 'string', in: 'cookie' }
                        ]
                    }
                }
            }, { request: { throw: true }});
        });

        it('invalid parameter', () => {
            expect(() => enforcer.request(5)).to.throw(/must be a string or an object/i);
        });

        describe('path and query', () => {

            it('as string path', () => {
                const result = enforcer.request('/hello');
                expect(result.path).to.equal('/hello');
            });

            it('as string path with query parameter', () => {
                const result = enforcer.request('/hello?name=Bob');
                expect(result.path).to.equal('/hello');
                expect(result.query).to.deep.equal({ name: 'Bob' });
            });

        });

        it('cookie as an object ok', () => {
            expect(() => enforcer.request({ path: '/hello', cookies: { a: 1 } })).not.to.throw(Error);
        });

        it('cookie as string throws error', () => {
            expect(() => enforcer.request({ path: '/hello', cookies: 'hello' })).to.throw(/invalid request cookie/i);
        });

        /*describe('body', () => {

            it('body input string for type string', () => {
                const result = enforcer.request({
                    path: '/hello',
                    method: 'post',
                    body: 'this is the body'
                });
                expect(result.request.body).to.equal('this is the body');
            });

            it('body input object for type string', () => {
                const result = enforcer.request({
                    path: '/hello',
                    method: 'post',
                    body: { x: 1 }
                });
                expect(result.request.body).to.equal('{"x":1}');
            });

        });*/

    });

});
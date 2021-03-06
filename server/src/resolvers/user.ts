import { Arg, Ctx, Field, Mutation, ObjectType, Query, Resolver, Int, Root, FieldResolver, UseMiddleware } from "type-graphql";
import { getConnection, UpdateResult } from "typeorm";
import { User } from "../entities/User";
import { validateRegister } from "../utils/validateRegister";
import { RegisterInput } from "./RegisterInput";
import argon from "argon2";
import { MyContext } from "../types";
import { Post } from "../entities/Post";
import { isAuth } from "../middlewares/isAuth";
import { FileUpload } from "graphql-upload";
import { GraphQLUpload } from "apollo-server-express";
import AWSApi from "../utils/awsApi";

@ObjectType()
class FieldError{
    @Field()
    field: string

    @Field()
    message: string
}

@ObjectType()
class UserResponse{
    @Field(() => FieldError, {nullable :true})
    error?: FieldError

    @Field(() => User, {nullable :true})
    user?: User
}

const api = new AWSApi()

@Resolver(User)
export class UserResolver{

    @Query(() => User, {nullable : true})
    async me(
        @Ctx() {req} : MyContext
    ) : Promise<User | null> {                
        const user = await User.findOne({where: {id: req.session.userId}})
        if(!user){
            return null;
        }
        return user;
    }

    
    @Mutation(() => User!)
    @UseMiddleware(isAuth)
    async uploadProfileImage(
        @Arg("file", () => GraphQLUpload!) file : FileUpload,
        @Ctx() {req} : MyContext
    ) : Promise<User>{
        const {userId} = req.session;

        const {filename, createReadStream} = await file;
        const key = `profile/${userId}/${filename}`

        const {url} = await api.upload(key, createReadStream);

        const result = await getConnection()
        .createQueryBuilder()
        .update(User)
        .set({
            url
        })
        .where("id = :id", {id : userId})
        .returning('*')
        .execute();

        const user = result.raw[0];

        return user;
    }

    @Mutation(() => UserResponse)
    async register(
        @Arg("options") options : RegisterInput,
        @Ctx() {req} : MyContext
    ) : Promise<UserResponse>{     
        const error = validateRegister(options);

        if(error){
            return error;
        }      

        const hash = await argon.hash(options.password);

        let user;

        try{
            const result = await getConnection()
                .createQueryBuilder()
                .insert()
                .into(User)
                .values({
                    ...options,
                    password : hash
                })
                .returning('*')
                .execute();            
            user = result.raw[0];
        }catch(e){
            console.log(e);
            if(e.code == '23505'){
                if(e.detail.includes("username")){
                    return {
                        error : {
                            field : "username",
                            message : "User with that username already exists",
                        } 
                    } 
                }else if(e.detail.includes("email")){
                    return {
                        error : {
                            field : "email",
                            message : "User with that email already exists",
                        } 
                    } 
                }
                return {
                    error : {
                        field : "password",
                        message : "Unexpected error",
                    } 
                } 
            }
        }          
        
        req.session.userId = user.id        

        return {user};
    }

    @Mutation(() => UserResponse)
    async login(
        @Arg("usernameOrEmail") usernameOrEmail : string,
        @Arg("password") password : string,
        @Ctx() {req} : MyContext
    ) : Promise<UserResponse>{     

        let isEmail = false;

        if(usernameOrEmail.includes('@')){
            isEmail = true;
        }

        const user = await User.findOne({
            where : isEmail ? 
                { email : usernameOrEmail} 
                : 
                {username : usernameOrEmail}
        })

        if(!user){
            return {
                error : {
                    field : 'usernameOrEmail',
                    message : 'user does not exists'
                }
            };
        }

        const valid = await argon.verify(user.password, password);

        if(!valid){
            return {
                error : {
                    field : 'password',
                    message : 'password is incorrect' 
                }
            }
        }

        req.session.userId = user.id;

        return {user};
    }

    @Mutation(() => Boolean)
    logout(
        @Ctx() {req, res} : MyContext
    ) : Promise<boolean>{
        return new Promise((resolve) => {
            req.session.destroy((err) => {
                res.clearCookie('qid');
                if(err){
                    console.log(err);
                    resolve(false);
                    return;
                }
                resolve(true);
            })
        })
    }
    
    @Query(() => User)
    async user(
        @Arg("id", () => Int, {nullable : true}) id : number,
        @Arg("username", {nullable : true}) username : string
    ) : Promise<User | null>{
        if(!id && !username){
            return null;
        }
        const user = await User.findOne({where : id ? {id} : {username}})
        if(!user){
            return null
        }
        return user;
    }

    @FieldResolver(() => [Post])
    async posts(
        @Root() user : User,
    ){
        const posts = await Post.find({where : {
            creatorId : user.id
        }})
        if(!posts){
            return null;
        }
        return posts;
    }
}